import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const THUMB_BASE = (Deno.env.get("SUPABASE_URL") || "") + "/storage/v1/object/public/vt-thumbs/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Creator Playfield (4 Okt 2026):
//  - Video: semua laporan VT yang disetujui dalam 30 hari terakhir, dikelompokkan per brand (terbaru dulu).
//    source: "hk" (request sample dari Harta Karun), "self" (produk milik sendiri), "campaign" (request sample biasa).
//  - Live: "Lagi live & laku" = creator dengan pesanan LIVE lewat Saturnine dalam 45 menit terakhir.
//    Live yang membawa produk Harta Karun yang sedang aktif ditandai hk = true (7 Okt 2026).
//  - Tampilan per peran:
//      internal & creator -> semua brand dengan namanya
//      brand              -> produknya sendiri lengkap (termasuk jumlah pesanan live);
//                            brand lain digabung jadi "Creator lain di Girlhood Den" tanpa nama brand/produk dan tanpa angka penjualan.
//  - 11 Okt 2026: brand dengan brands.tampil_username = true (sekarang hanya KIME) melihat username TikTok
//    creator yang sedang live membawa produk brand itu. Live yang tidak membawa produknya tetap tanpa username.
//  - 28 Nov 2026: biar cepat, tiap brand hanya mengirim PER_BRAND video (creator berbeda dulu), sisanya diminta
//    lewat { brand, offset }. Data video 30 hari disimpan di tabel playfield_cache (disegarkan cron tiap 5 menit
//    lewat { segarkan: true } + x-sync-token) dan di memori, jadi pengunjung tidak menunggu query berat. Video tanpa sampul
//    permanen tetap dikirim (cover_image_url null) supaya tampilan bisa memakai kartu cadangan.
//  - 28 Nov 2026: "Lagi live & laku" digabung dengan "Terlaku minggu ini" (peringkat 5 creator dari pesanan LIVE
//    7 hari, fungsi SQL playfield_live_7hari, ikut disimpan di cache). Tiap kartu membawa foto produk (brand_products.foto_urls),
//    produk untuk tombol "Ajukan sampel" (bp_id, hanya bila brand aktif & tidak di-freeze, hanya untuk creator),
//    dan username untuk tombol "Tonton live" (internal & creator; brand tetap aturan tampil_username).
//    Jumlah pesanan hanya untuk internal, dan untuk brand atas produknya sendiri.
const HARI = 30, MENIT_LIVE = 45, GRUP_LAIN = "lain", PER_BRAND = 8, CACHE_MS = 2 * 60000, CACHE_TABEL_MS = 15 * 60000;
const SYNC_TOKEN = "ghd-thumb-sync-2026";

async function semuaBaris(buat: () => any): Promise<any[]> {
  const hasil: any[] = [];
  for (let dari = 0; dari < 50000; dari += 1000) {
    const { data, error } = await buat().range(dari, dari + 999);
    if (error) throw new Error(error.message);
    hasil.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return hasil;
}
async function ambilPerId(tabel: string, kolom: string, ids: string[]): Promise<Record<string, any>> {
  const peta: Record<string, any> = {};
  const potong: string[][] = [];
  for (let i = 0; i < ids.length; i += 300) potong.push(ids.slice(i, i + 300));
  await Promise.all(potong.map(async (p) => {
    const { data } = await supabaseAdmin.from(tabel).select(kolom).in("id", p);
    for (const r of data || []) peta[(r as any).id] = r;
  }));
  return peta;
}
function usernameDariProfil(link: string | null | undefined): string | null {
  const m = String(link || "").match(/@([A-Za-z0-9._]+)/);
  return m ? m[1].toLowerCase() : null;
}

// Produk TikTok yang sedang ada di Harta Karun aktif (tayang dan dalam periode, WIB).
async function produkHartaKarunAktif(): Promise<Set<string>> {
  const hariIni = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin.from("hk_produk")
    .select("tiktok_product_id, hk_campaign!inner(status, periode_mulai, periode_selesai)")
    .eq("hk_campaign.status", "tayang").lte("hk_campaign.periode_mulai", hariIni).gte("hk_campaign.periode_selesai", hariIni);
  return new Set((data || []).map((r: any) => r.tiktok_product_id).filter(Boolean));
}

// Peran penonton dari token login (opsional). Tanpa login diperlakukan seperti creator.
// masuk = penonton login (username TikTok & tombol sampel hanya untuk yang login).
async function peranPenonton(req: Request): Promise<{ peran: "internal" | "brand" | "creator"; brandId: string | null; tampilUsername: boolean; masuk: boolean }> {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!token) return { peran: "creator", brandId: null, tampilUsername: false, masuk: false };
  const { data } = await supabaseAdmin.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return { peran: "creator", brandId: null, tampilUsername: false, masuk: false };
  const { data: staff } = await supabaseAdmin.from("internal_staff").select("id").eq("auth_user_id", uid).eq("is_active", true).maybeSingle();
  if (staff) return { peran: "internal", brandId: null, tampilUsername: false, masuk: true };
  const { data: brand } = await supabaseAdmin.from("brands").select("id, tampil_username").eq("user_id", uid).maybeSingle();
  if (brand) return { peran: "brand", brandId: brand.id, tampilUsername: !!brand.tampil_username, masuk: true };
  return { peran: "creator", brandId: null, tampilUsername: false, masuk: true };
}

// ===== Video 30 hari (tanpa aturan peran), disimpan di memori 5 menit =====
type Video = { report_id: string; video_id: string; cover_image_url: string | null; cover_permanent: boolean; member_id: string | null; creator_nama: string; tier: string | null; produk: string; source: string; submitted_at: string };
type DataBrand = { brand_id: string; nama: string; logo_url: string | null; videos: Video[] };
type BarisLive = { username: string; member_id: string; nama: string; tier: string | null; product_id: string; product_name: string | null; pesanan: number; terakhir: string };
// bp_id null = produk TikTok belum terhubung ke katalog; brand ditebak dari nama produk (tombol jadi "Lihat produk brand").
type InfoProduk = { bp_id: string | null; brand_id: string; brand: string; brand_logo: string | null; nama_produk: string | null; foto: string | null; bisa_sampel: boolean };
type DataCache = { brands: DataBrand[]; peringkat: BarisLive[]; produk: Record<string, InfoProduk>; sampul: Record<string, string> };
let cache: { waktu: number; isi: DataCache } | null = null;
let sedangMuat: Promise<DataCache> | null = null;
const KUNCI_CACHE = "v2";

// Nama brand di depan nama produk TikTok (setelah tag seperti "[NEW]" / "【PROMO】"), mis. "HANASUI Mattedorable ..." -> Hanasui.
const rapikan = (t: string) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function tebakBrand(namaProduk: string | null, brands: any[]): any | null {
  if (!namaProduk) return null;
  const awal = " " + rapikan(namaProduk.replace(/^(\s*(\[[^\]]*\]|【[^】]*】|\([^)]*\)))+/, "")).split(" ").slice(0, 5).join(" ") + " ";
  let pilih: any = null, posisi = Infinity;
  for (const b of brands) {
    const n = rapikan(b.nama_brand || ""); if (n.length < 3) continue;
    const i = awal.indexOf(" " + n + " ");
    if (i >= 0 && awal.slice(1, i + 1).split(" ").filter(Boolean).length > 1) continue; // nama brand harus mulai di 2 kata pertama
    if (i >= 0 && (i < posisi || (i === posisi && n.length > rapikan(pilih.nama_brand).length))) { pilih = b; posisi = i; }
  }
  return pilih;
}

// Info produk TikTok -> produk & brand di Girlhood Den (foto, boleh diajukan sampel atau tidak).
async function infoProduk(daftar: { pid: string; nama: string | null }[]): Promise<Record<string, InfoProduk>> {
  const hasil: Record<string, InfoProduk> = {};
  const unik = [...new Set(daftar.map((d) => d.pid).filter(Boolean))];
  for (let i = 0; i < unik.length; i += 300) {
    const { data } = await supabaseAdmin.from("brand_products")
      .select("id, brand_id, tiktok_product_id, nama_produk, foto_urls, is_frozen, brands(nama_brand, logo_url, is_active, is_frozen)")
      .in("tiktok_product_id", unik.slice(i, i + 300));
    for (const r of (data || []) as any[]) {
      if (hasil[r.tiktok_product_id] || !r.brands) continue;
      const foto = Array.isArray(r.foto_urls) ? r.foto_urls.find((f: unknown) => typeof f === "string" && f) || null : null;
      hasil[r.tiktok_product_id] = {
        bp_id: r.id, brand_id: r.brand_id, brand: r.brands.nama_brand, brand_logo: r.brands.logo_url || null,
        nama_produk: r.nama_produk, foto,
        bisa_sampel: !!r.brands.is_active && !r.brands.is_frozen && !r.is_frozen,
      };
    }
  }
  const belum = daftar.filter((d) => d.pid && !hasil[d.pid]);
  if (belum.length) {
    const { data: brands } = await supabaseAdmin.from("brands").select("id, nama_brand, logo_url, is_active, is_frozen").eq("is_active", true);
    for (const d of belum) {
      const b = tebakBrand(d.nama, brands || []);
      if (b) hasil[d.pid] = { bp_id: null, brand_id: b.id, brand: b.nama_brand, brand_logo: b.logo_url || null, nama_produk: null, foto: null, bisa_sampel: !b.is_frozen };
    }
  }
  return hasil;
}

async function muatVideo(): Promise<DataBrand[]> {
  const sejak = new Date(Date.now() - HARI * 86400000).toISOString();
  const reports = await semuaBaris(() => supabaseAdmin.from("vt_reports")
    .select("id, sample_request_id, submitted_at, thumb_path, oembed_video_id")
    .eq("status", "approved").gte("submitted_at", sejak).not("oembed_video_id", "is", null)
    .order("submitted_at", { ascending: false }).order("id"));
  const srById = await ambilPerId("sample_requests", "id, member_id, brand_product_id, sumber, hk_campaign_id", [...new Set(reports.map((r) => r.sample_request_id).filter(Boolean))]);
  const bpIds = [...new Set(Object.values(srById).map((s: any) => s.brand_product_id).filter(Boolean))];
  const memberIds = [...new Set(Object.values(srById).map((s: any) => s.member_id).filter(Boolean))];
  const [bpById, memberById] = await Promise.all([
    ambilPerId("brand_products", "id, brand_id, nama_produk", bpIds),
    ambilPerId("members", "id, nama, tier", memberIds),
  ]);
  const brandById = await ambilPerId("brands", "id, nama_brand, logo_url", [...new Set(Object.values(bpById).map((b: any) => b.brand_id).filter(Boolean))]);

  const peta: Record<string, DataBrand> = {};
  for (const r of reports) {
    const sr = srById[r.sample_request_id]; if (!sr) continue;
    const bp = bpById[sr.brand_product_id]; if (!bp) continue;
    const brand = brandById[bp.brand_id]; if (!brand) continue;
    const b = peta[brand.id] ||= { brand_id: brand.id, nama: brand.nama_brand, logo_url: brand.logo_url, videos: [] };
    const member = memberById[sr.member_id];
    b.videos.push({
      report_id: r.id,
      video_id: r.oembed_video_id,
      cover_image_url: r.thumb_path ? THUMB_BASE + r.thumb_path : null,
      cover_permanent: !!r.thumb_path,
      member_id: sr.member_id || null,
      creator_nama: member ? member.nama : "Creator",
      tier: member?.tier || null,
      produk: bp.nama_produk,
      source: sr.hk_campaign_id ? "hk" : (sr.sumber === "self_report" ? "self" : "campaign"),
      submitted_at: r.submitted_at,
    });
  }
  return Object.values(peta);
}
async function bangunUlang(): Promise<DataCache> {
  const [brands, rpc] = await Promise.all([muatVideo(), supabaseAdmin.rpc("playfield_live_7hari")]);
  if (rpc.error) throw new Error(rpc.error.message);
  const peringkat = ((rpc.data || []) as any[]).map((r) => ({ ...r, pesanan: Number(r.pesanan) })) as BarisLive[];
  const produk = await infoProduk(peringkat.map((r) => ({ pid: r.product_id, nama: r.product_name })));
  // Sampul video terbaru tiap creator, cadangan kalau produk tidak punya foto.
  const sampul: Record<string, string> = {}, sampulWaktu: Record<string, string> = {};
  for (const b of brands) for (const v of b.videos) {
    if (!v.member_id || !v.cover_image_url) continue;
    const ada = sampul[v.member_id];
    if (!ada || (sampulWaktu[v.member_id] < v.submitted_at)) { sampul[v.member_id] = v.cover_image_url; sampulWaktu[v.member_id] = v.submitted_at; }
  }
  const isi: DataCache = { brands, peringkat, produk, sampul };
  await supabaseAdmin.from("playfield_cache").upsert({ kunci: KUNCI_CACHE, data: isi, dibuat_at: new Date().toISOString() });
  cache = { waktu: Date.now(), isi };
  return isi;
}
async function dataCache(): Promise<DataCache> {
  if (cache && Date.now() - cache.waktu < CACHE_MS) return cache.isi;
  const { data: baris } = await supabaseAdmin.from("playfield_cache").select("data, dibuat_at").eq("kunci", KUNCI_CACHE).maybeSingle();
  if (baris && Date.now() - new Date(baris.dibuat_at).getTime() < CACHE_TABEL_MS) {
    cache = { waktu: Date.now(), isi: baris.data as DataCache };
    return cache.isi;
  }
  if (!sedangMuat) sedangMuat = bangunUlang().finally(() => { sedangMuat = null; });
  return await sedangMuat;
}

// Urutan tampil: video terbaru tiap creator dulu (satu kartu satu creator), lalu video lain dari terbaru.
// Di dalam tiap bagian, video yang punya sampul didahulukan.
function urutTampil(videos: Video[]): Video[] {
  const sudah = new Set<string>(), pertama: Video[] = [], sisa: Video[] = [];
  for (const v of videos) {
    const k = v.member_id || v.report_id;
    if (sudah.has(k)) sisa.push(v); else { sudah.add(k); pertama.push(v); }
  }
  const adaSampul = (a: Video, b: Video) => Number(b.cover_permanent) - Number(a.cover_permanent);
  return [...pertama.sort(adaSampul), ...sisa.sort(adaSampul)];
}
// Nama produk TikTok tanpa tag promo di depan, maksimal 70 huruf.
const pendek = (t: string | null | undefined) => {
  const x = String(t || "").replace(/^(\s*(\[[^\]]*\]|【[^】]*】))+/, "").trim();
  return x ? (x.length > 70 ? x.slice(0, 68).trimEnd() + "…" : x) : null;
};
const bersih = (v: Video, tutup: boolean) => {
  const { member_id: _m, ...rest } = v;
  return tutup ? { ...rest, produk: null } : rest;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: any = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { body = {}; } }
    const url = new URL(req.url);
    if (body.segarkan === true) {
      if (req.headers.get("x-sync-token") !== SYNC_TOKEN) return J({ error: "unauthorized" }, 401);
      const b = await bangunUlang();
      return J({ ok: true, brand: b.brands.length, video: b.brands.reduce((n, x) => n + x.videos.length, 0), baris_live: b.peringkat.length });
    }
    const mintaBrand = String(body.brand ?? url.searchParams.get("brand") ?? "") || null;
    const offset = Math.max(0, Number(body.offset ?? url.searchParams.get("offset") ?? 0) || 0);
    const batas = Math.min(40, Math.max(1, Number(body.limit ?? url.searchParams.get("limit") ?? PER_BRAND) || PER_BRAND));

    const [{ peran, brandId: brandSaya, tampilUsername, masuk }, isiCache] = await Promise.all([peranPenonton(req), dataCache()]);
    const semuaBrand = isiCache.brands;
    const sembunyikan = (bid: string) => peran === "brand" && bid !== brandSaya;

    // Gabungkan sesuai peran (brand lain disamarkan jadi satu grup bagi penonton brand).
    const grup: Record<string, { brand_id: string; nama: string; logo_url: string | null; milik_sendiri: boolean; disamarkan: boolean; videos: Video[] }> = {};
    for (const b of semuaBrand) {
      const tutup = sembunyikan(b.brand_id);
      const kunci = tutup ? GRUP_LAIN : b.brand_id;
      const g = grup[kunci] ||= tutup
        ? { brand_id: GRUP_LAIN, nama: "Creator lain di Girlhood Den", logo_url: null, milik_sendiri: false, disamarkan: true, videos: [] }
        : { brand_id: b.brand_id, nama: b.nama, logo_url: b.logo_url, milik_sendiri: peran === "brand" && b.brand_id === brandSaya, disamarkan: false, videos: [] };
      g.videos.push(...b.videos);
    }
    for (const g of Object.values(grup)) {
      if (g.disamarkan) g.videos.sort((a, b) => (b.submitted_at > a.submitted_at ? 1 : -1));
      g.videos = urutTampil(g.videos);
    }

    // Muat lanjutan satu brand.
    if (mintaBrand) {
      const g = grup[mintaBrand];
      if (!g) return J({ brand_id: mintaBrand, videos: [], total: 0, offset });
      return J({ brand_id: g.brand_id, total: g.videos.length, offset, videos: g.videos.slice(offset, offset + batas).map((v) => bersih(v, g.disamarkan)) });
    }

    const brandsOut = Object.values(grup).filter((g) => g.videos.length > 0)
      .sort((a, b) => (b.milik_sendiri ? 1 : 0) - (a.milik_sendiri ? 1 : 0) || (a.disamarkan ? 1 : 0) - (b.disamarkan ? 1 : 0) || b.videos.length - a.videos.length)
      .map((g) => ({ ...g, total: g.videos.length, videos: g.videos.slice(0, batas).map((v) => bersih(v, g.disamarkan)) }));

    // ===== Terlaku minggu ini (5 creator, pesanan LIVE 7 hari) =====
    const produkInfo: Record<string, InfoProduk> = { ...isiCache.produk };
    const sampul = isiCache.sampul || {};
    const tombolProduk = (info: InfoProduk | undefined, memberId?: string | null) => {
      // Sampul video creator bisa berisi produk brand lain, jadi tidak dipakai untuk penonton brand.
      const cadangan = memberId && peran !== "brand" ? sampul[memberId] || null : null;
      if (!info) return { foto: cadangan, brand: null, brand_id: null, brand_logo: null, produk_utama: null, bp_id: null, sampel_brand: false };
      const bolehSampel = peran === "creator" && masuk && info.bisa_sampel;
      return {
        foto: info.foto || cadangan, brand: info.brand, brand_id: info.brand_id, brand_logo: info.brand_logo, produk_utama: pendek(info.nama_produk),
        bp_id: bolehSampel ? info.bp_id : null,
        sampel_brand: bolehSampel && !info.bp_id, // produk belum terhubung: buka daftar produk brand-nya
      };
    };
    const perCreator7: Record<string, { b: BarisLive; total: number; perProduk: Record<string, number>; namaProduk: Record<string, string | null> }> = {};
    for (const r of isiCache.peringkat) {
      if (peran === "brand" && produkInfo[r.product_id]?.brand_id !== brandSaya) continue; // brand hanya melihat produknya sendiri
      const c = perCreator7[r.username] ||= { b: r, total: 0, perProduk: {}, namaProduk: {} };
      c.total += r.pesanan;
      c.perProduk[r.product_id] = (c.perProduk[r.product_id] || 0) + r.pesanan;
      c.namaProduk[r.product_id] = r.product_name;
    }
    const peringkat = Object.values(perCreator7).sort((a, b) => b.total - a.total).slice(0, 5).map((c) => {
      const pidUtama = Object.entries(c.perProduk).sort((a, b) => b[1] - a[1])[0][0];
      const info = produkInfo[pidUtama];
      const item: any = {
        creator_nama: c.b.nama, tier: c.b.tier || null,
        ...tombolProduk(info, c.b.member_id),
        produk_utama: pendek(info?.nama_produk) || pendek(c.namaProduk[pidUtama]),
      };
      if (peran === "internal" || peran === "brand") item.pesanan = c.total;
      if ((peran !== "brand" && masuk) || tampilUsername) item.username = c.b.username;
      return item;
    });

    // ===== Lagi live & laku (pesanan LIVE lewat Saturnine dalam 45 menit terakhir) =====
    const batasLive = new Date(Date.now() - MENIT_LIVE * 60000).toISOString();
    const { data: pesanan } = await supabaseAdmin.from("tap_orders").select("creator_username, product_id, product_name, order_id, dibuat_at")
      .eq("content_type", "LIVE").gte("dibuat_at", batasLive).in("settle_status", ["PENDING", "SETTLED"]).limit(2000);
    const live: any[] = [];
    if (pesanan && pesanan.length) {
      const hkPids = await produkHartaKarunAktif();
      // Peta username -> member (hanya member terverifikasi) dan produk TikTok -> brand.
      const usernames = [...new Set(pesanan.map((p: any) => String(p.creator_username || "").toLowerCase()).filter(Boolean))];
      const { data: members } = await supabaseAdmin.from("members").select("id, nama, tier, tiktok_profile_link").eq("status", "verified")
        .or(usernames.map((u) => "tiktok_profile_link.ilike.%@" + u.replace(/[,()]/g, "") + "%").join(","));
      const memberByUn: Record<string, any> = {};
      for (const m of members || []) { const un = usernameDariProfil(m.tiktok_profile_link); if (un && usernames.includes(un)) memberByUn[un] = m; }
      const pids = [...new Set(pesanan.map((p: any) => p.product_id).filter(Boolean))];
      const brandByPid: Record<string, string> = {};
      for (let i = 0; i < pids.length; i += 300) {
        const { data: bps } = await supabaseAdmin.from("brand_products").select("tiktok_product_id, brand_id").in("tiktok_product_id", pids.slice(i, i + 300));
        for (const b of bps || []) brandByPid[b.tiktok_product_id] = b.brand_id;
      }
      const namaPid: Record<string, string | null> = {};
      for (const p of pesanan) if (p.product_id && !namaPid[p.product_id]) namaPid[p.product_id] = p.product_name || null;
      const kurang = pids.filter((pid) => !produkInfo[pid]).map((pid) => ({ pid, nama: namaPid[pid] }));
      if (kurang.length) Object.assign(produkInfo, await infoProduk(kurang));
      // Produk yang belum terhubung ke katalog ikut brand tebakan dari namanya.
      for (const pid of pids) if (!brandByPid[pid] && produkInfo[pid]) brandByPid[pid] = produkInfo[pid].brand_id;
      const brandLive = await ambilPerId("brands", "id, nama_brand", [...new Set(Object.values(brandByPid))]);
      const produkTeratas = (entri: any[]) => {
        let best: string | null = null, n = -1;
        for (const e of entri) for (const [pid, set] of Object.entries(e.perPid as Record<string, Set<string>>)) if (set.size > n) { n = set.size; best = pid; }
        return best ? produkInfo[best] : undefined;
      };

      const perCreator: Record<string, any> = {};
      for (const p of pesanan) {
        const un = String(p.creator_username || "").toLowerCase();
        const m = memberByUn[un]; if (!m) continue; // hanya creator komunitas
        const bid = brandByPid[p.product_id] || null;
        const c = perCreator[un] ||= { username: un, member_id: m.id, creator_nama: m.nama, tier: m.tier || null, terakhir: p.dibuat_at, brands: {} as Record<string, any> };
        if (p.dibuat_at > c.terakhir) c.terakhir = p.dibuat_at;
        const kunciBrand = bid || "tanpa_brand";
        const b = c.brands[kunciBrand] ||= { brand_id: bid, pesanan: new Set<string>(), produk: new Set<string>(), hk: false, perPid: {} as Record<string, Set<string>> };
        b.pesanan.add(p.order_id);
        (b.perPid[p.product_id] ||= new Set<string>()).add(p.order_id);
        if (hkPids.has(p.product_id)) b.hk = true;
        const pn = pendek(p.product_name); if (pn) b.produk.add(pn);
      }
      for (const c of Object.values(perCreator) as any[]) {
        const entri = Object.values(c.brands) as any[];
        const punyaSaya = peran === "brand" ? entri.find((e) => e.brand_id === brandSaya) : null;
        const item: any = { creator_nama: c.creator_nama, tier: c.tier, terakhir: c.terakhir, milik_sendiri: !!punyaSaya };
        if (peran !== "brand") { Object.assign(item, tombolProduk(produkTeratas(entri), c.member_id)); if (masuk) item.username = c.username; }
        if (peran === "brand") {
          if (punyaSaya) {
            Object.assign(item, tombolProduk(produkTeratas([punyaSaya]), c.member_id));
            item.brand = brandLive[brandSaya!]?.nama_brand || null; item.produk = [...punyaSaya.produk].slice(0, 3); item.pesanan = punyaSaya.pesanan.size; item.hk = punyaSaya.hk;
            // Username hanya untuk brand yang diizinkan, dan hanya untuk live yang membawa produk brand itu.
            if (tampilUsername) item.username = c.username;
          }
        } else {
          item.brand = [...new Set(entri.map((e) => brandLive[e.brand_id]?.nama_brand).filter(Boolean))].join(", ") || null;
          item.produk = [...new Set(entri.flatMap((e) => [...e.produk]))].slice(0, 3);
          item.hk = entri.some((e) => e.hk);
          if (peran === "internal") item.pesanan = entri.reduce((s, e) => s + e.pesanan.size, 0);
        }
        live.push(item);
      }
      live.sort((a, b) => (b.milik_sendiri ? 1 : 0) - (a.milik_sendiri ? 1 : 0) || (b.terakhir > a.terakhir ? 1 : -1));
    }

    return J({ peran, brands: brandsOut, live, peringkat, hari: HARI, menit_live: MENIT_LIVE, per_brand: batas });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
