import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

// Ambil thumbnail TikTok lalu SIMPAN GAMBARNYA ke Storage (bucket vt-thumbs).
// Link cover dari TikTok kedaluwarsa ~2 hari, jadi yang dipakai di UI adalah file di Storage.
// Gambar dikecilkan ke lebar 320px biar hemat storage (~40KB per file).
// Idempotent: baris yang thumb_path-nya sudah terisi dilewati.
// chain=true -> lanjut sendiri batch berikutnya di background sampai habis (buat backfill).
// Juga menyimpan username pemilik video (oembed_author) untuk cek "bukan akun sendiri":
// dibaca dari oEmbed, atau dari alamat lengkap hasil membuka link pendek (tiktok.com/@username/video/ID).
// isiAuthor=true -> hanya mengisi oembed_author untuk laporan yang belum dicek (tanpa thumbnail).
// 28 Nov 2026: sejak ±19 Okt oEmbed TikTok tidak lagi memberi thumbnail_url, jadi sampul diambil dari
// halaman video publiknya (tiktok.com/@username/video/ID, field "cover") sebagai jalur kedua.

const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SYNC_TOKEN = "ghd-thumb-sync-2026";
const BUCKET = "vt-thumbs";
const MAX_LIMIT = 60;
const TIME_BUDGET_MS = 100000;
const TARGET_WIDTH = 320;
const SELF_URL = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/sync-vt-thumbnails";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-sync-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Row = { id: string; video_url: string | null; oembed_video_id: string | null; oembed_author?: string | null };

function parseLink(u: string): { author: string | null; videoId: string | null } {
  const m = u.match(/tiktok\.com\/@([^/?#]+)\/(?:video|photo)\/(\d+)/i);
  return m ? { author: decodeURIComponent(m[1]).toLowerCase(), videoId: m[2] } : { author: null, videoId: null };
}

// Buka link (termasuk link pendek vt.tiktok.com) sampai ketemu alamat lengkap berisi @username dan ID video.
async function bacaDariLink(videoUrl: string): Promise<{ author: string | null; videoId: string | null }> {
  let url = videoUrl.trim();
  for (let i = 0; i < 4; i++) {
    const p = parseLink(url);
    if (p.author) return p;
    try {
      const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
      const lok = r.headers.get("location");
      await r.body?.cancel();
      if (!lok) break;
      url = new URL(lok, url).toString();
    } catch { break; }
  }
  return parseLink(url);
}

async function fetchOembed(videoUrl: string): Promise<{ thumb: string | null; videoId: string | null; author: string | null; note: string | null }> {
  try {
    const res = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(videoUrl), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GirlhoodDenBot/1.0)" },
    });
    if (!res.ok) return { thumb: null, videoId: null, author: null, note: "oembed http " + res.status };
    const json = await res.json();
    const thumb = json.thumbnail_url || null;
    const videoId = json.embed_product_id || null;
    const author = json.author_unique_id ? String(json.author_unique_id).toLowerCase() : null;
    if (!thumb) return { thumb: null, videoId, author, note: "tidak ada thumbnail (video private/dihapus?)" };
    return { thumb, videoId, author, note: null };
  } catch (e) {
    return { thumb: null, videoId: null, author: null, note: "oembed error: " + String(e) };
  }
}

// Jalur kedua: sampul dari halaman video publik TikTok.
async function coverDariHalaman(author: string, videoId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/@${encodeURIComponent(author)}/video/${videoId}`, {
      headers: { "User-Agent": UA_DESKTOP, "Accept-Language": "id-ID,id;q=0.9" },
    });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const t = await r.text();
    // zoomCover 480/240 sudah JPEG kecil; "cover" ukuran asli (berat untuk dikecilkan di sini).
    const zoom = t.match(/"zoomCover":\{([^}]*)\}/);
    const m = (zoom && (zoom[1].match(/"480":"(https:[^"]+)"/) || zoom[1].match(/"240":"(https:[^"]+)"/)))
      || t.match(/"cover":"(https:[^"]+)"/) || t.match(/"originCover":"(https:[^"]+)"/);
    return m ? JSON.parse('"' + m[1] + '"') : null;
  } catch {
    return null;
  }
}

async function cariAuthor(videoUrl: string, dariOembed: string | null): Promise<{ author: string | null; videoId: string | null }> {
  if (dariOembed) return { author: dariOembed, videoId: null };
  return await bacaDariLink(videoUrl);
}

async function shrink(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const img = await decodeImage(bytes);
    if (!(img instanceof Image)) return null;
    if (img.width > TARGET_WIDTH) img.resize(TARGET_WIDTH, Image.RESIZE_AUTO);
    return await img.encodeJPEG(80);
  } catch {
    return null;
  }
}

async function storeThumb(rowId: string, thumbUrl: string): Promise<{ path: string | null; note: string | null }> {
  try {
    const res = await fetch(thumbUrl, { headers: { "User-Agent": UA_DESKTOP, Referer: "https://www.tiktok.com/" } });
    if (!res.ok) return { path: null, note: "download thumb http " + res.status };
    const original = new Uint8Array(await res.arrayBuffer());
    if (original.byteLength === 0) return { path: null, note: "file thumbnail kosong" };

    // File yang sudah kecil tidak perlu dikecilkan lagi (hemat CPU).
    const small = original.byteLength > 150000 ? await shrink(original) : null;
    const bytes = small ?? original;
    const contentType = small ? "image/jpeg" : (res.headers.get("content-type") || "image/jpeg").split(";")[0].replace("image/jpg", "image/jpeg");
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = rowId + "." + ext;

    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType, upsert: true, cacheControl: "31536000",
    });
    if (error) return { path: null, note: "upload gagal: " + error.message };
    return { path, note: null };
  } catch (e) {
    return { path: null, note: "store error: " + String(e) };
  }
}

async function syncRow(row: Row): Promise<"ok" | "fail"> {
  if (!row.video_url) {
    await supabaseAdmin.from("vt_reports").update({ thumb_error: "video_url kosong", thumb_synced_at: new Date().toISOString() }).eq("id", row.id);
    return "fail";
  }
  const oe = await fetchOembed(row.video_url);
  const au = row.oembed_author && !oe.author ? { author: row.oembed_author, videoId: null } : await cariAuthor(row.video_url, oe.author);
  const authorPatch: Record<string, unknown> = { oembed_author_checked_at: new Date().toISOString() };
  if (au.author) authorPatch.oembed_author = au.author;
  const vid = oe.videoId || au.videoId || row.oembed_video_id;
  let thumb = oe.thumb;
  if (!thumb && au.author && vid) thumb = await coverDariHalaman(au.author, vid);
  if (!thumb) {
    const patch: Record<string, unknown> = { ...authorPatch, thumb_error: oe.note || "sampul tidak ditemukan", thumb_synced_at: new Date().toISOString() };
    if (vid && !row.oembed_video_id) patch.oembed_video_id = vid;
    await supabaseAdmin.from("vt_reports").update(patch).eq("id", row.id);
    return "fail";
  }
  const stored = await storeThumb(row.id, thumb);
  if (!stored.path) {
    await supabaseAdmin.from("vt_reports").update({ ...authorPatch, thumb_error: stored.note, thumb_synced_at: new Date().toISOString() }).eq("id", row.id);
    return "fail";
  }
  const patch: Record<string, unknown> = {
    ...authorPatch,
    thumb_path: stored.path,
    thumb_error: null,
    thumb_synced_at: new Date().toISOString(),
    oembed_cover_url: thumb,
    oembed_fetched_at: new Date().toISOString(),
  };
  if (vid) patch.oembed_video_id = vid;
  await supabaseAdmin.from("vt_reports").update(patch).eq("id", row.id);
  return "ok";
}

// Hanya isi username pemilik video (dan ID video bila kosong), tanpa mengunduh thumbnail.
async function isiAuthorRow(row: Row): Promise<"ok" | "fail"> {
  if (!row.video_url) {
    await supabaseAdmin.from("vt_reports").update({ oembed_author_checked_at: new Date().toISOString() }).eq("id", row.id);
    return "fail";
  }
  let au = await bacaDariLink(row.video_url);
  if (!au.author) { const oe = await fetchOembed(row.video_url); au = { author: oe.author, videoId: oe.videoId }; }
  const patch: Record<string, unknown> = { oembed_author_checked_at: new Date().toISOString() };
  if (au.author) patch.oembed_author = au.author;
  if (au.videoId && !row.oembed_video_id) patch.oembed_video_id = au.videoId;
  await supabaseAdmin.from("vt_reports").update(patch).eq("id", row.id);
  return au.author ? "ok" : "fail";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const token = req.headers.get("x-sync-token") || url.searchParams.get("token") || "";
  if (token !== SYNC_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { body = {}; } }

  const reportId = (body.reportId as string) || url.searchParams.get("reportId") || null;
  const limitRaw = Number(body.limit ?? url.searchParams.get("limit") ?? 25);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), MAX_LIMIT);
  const retryFailed = String(body.retryFailed ?? url.searchParams.get("retryFailed") ?? "") === "true";
  const force = String(body.force ?? url.searchParams.get("force") ?? "") === "true";
  const chain = String(body.chain ?? url.searchParams.get("chain") ?? "") === "true";
  const isiAuthor = String(body.isiAuthor ?? "") === "true";
  const startedAt = Date.now();

  if (isiAuthor) {
    const { data: rows, error } = await supabaseAdmin.from("vt_reports").select("id, video_url, oembed_video_id")
      .is("oembed_author_checked_at", null).order("submitted_at", { ascending: false }).limit(limit);
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    let ok = 0, fail = 0;
    const antre = [...((rows || []) as Row[])];
    async function pekerja() {
      while (antre.length && Date.now() - startedAt < TIME_BUDGET_MS) {
        const row = antre.shift()!;
        if ((await isiAuthorRow(row)) === "ok") ok++; else fail++;
      }
    }
    await Promise.all([pekerja(), pekerja(), pekerja()]);
    const { count: sisa } = await supabaseAdmin.from("vt_reports").select("id", { count: "exact", head: true }).is("oembed_author_checked_at", null);
    return new Response(JSON.stringify({ ok: true, mode: "isiAuthor", saved: ok, failed: fail, remaining: sisa ?? null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let query;
  if (reportId) {
    query = supabaseAdmin.from("vt_reports").select("id, video_url, oembed_video_id, oembed_author").eq("id", reportId);
    if (!force) query = query.is("thumb_path", null);
  } else {
    query = supabaseAdmin.from("vt_reports").select("id, video_url, oembed_video_id, oembed_author");
    if (force) {
      query = query.not("thumb_path", "is", null);
    } else {
      query = query.is("thumb_path", null);
      if (!retryFailed) query = query.is("thumb_synced_at", null);
    }
    query = query.order("submitted_at", { ascending: false }).limit(limit);
  }

  const { data: rows, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const list = (rows || []) as Row[];
  let ok = 0, fail = 0, processed = 0;
  for (const row of list) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const result = await syncRow(row);
    processed++;
    if (result === "ok") ok++; else fail++;
  }

  const { count: remaining } = await supabaseAdmin.from("vt_reports")
    .select("id", { count: "exact", head: true })
    .is("thumb_path", null).is("thumb_synced_at", null);

  let chained = false;
  if (chain && !reportId && !force && processed > 0 && (remaining ?? 0) > 0) {
    chained = true;
    const next = fetch(SELF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sync-token": SYNC_TOKEN },
      body: JSON.stringify({ limit, chain: true }),
    }).then(() => {}).catch(() => {});
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(next);
  }

  return new Response(JSON.stringify({ ok: true, processed, saved: ok, failed: fail, remaining: remaining ?? null, chained }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
