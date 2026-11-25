// Pantau Live (tahap 1): peringatan untuk operator saat live berjalan.
// Browser studio mengirim tiap 30 detik: 1 foto layar dashboard live + rekaman suara 30 detik.
// Server: suara → tulisan (Groq Whisper turbo), foto + tulisan → Claude Haiku membaca angka & komentar,
// lalu aturan peringatan dijalankan KODE (bukan AI). Foto dan suara tidak disimpan, hanya hasil bacaannya.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const MODEL = "claude-haiku-5-5"; // cepat & murah: dipanggil tiap 30 detik
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});

// aturan peringatan
const ANJLOK_PERSEN = 30, ANJLOK_JENDELA = 180; // penonton turun ≥30% dari puncak 3 menit terakhir
const GMV_DIAM_DETIK = 600; // GMV tidak bertambah 10 menit
const TANPA_JUALAN_DETIK = 300; // 5 menit tanpa menyebut produk/harga/keranjang
const JEDA: Record<string, number> = { anjlok: 300, gmv_diam: 600, tanpa_jualan: 300, pertanyaan: 300 };
const KATA_JUALAN = ["keranjang", "harga", "checkout", "check out", "beli", "produk", "promo", "diskon", "flash sale", "voucher", "stok", "ribu", "klik", "pesan", "order", "gratis ongkir", "bundling", "serum", "toner", "cream", "krim", "sunscreen", "lipstik", "cushion", "skincare", "makeup"];

function idSesi(jwt: string): string | null {
  try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || null; } catch { return null; }
}
async function staffDari(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: s } = await db.from("internal_staff").select("id, nama").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  if (!s) return null;
  const sesi = idSesi(jwt);
  const { data: sah } = sesi ? await db.rpc("aura_sesi_sah", { p_sesi: sesi, p_staff: s.id }) : { data: false };
  if (sah !== true) return null;
  const { data: cfg } = await db.from("app_config").select("key, value").in("key", ["kantor_ceo", "kantor_coo", "lab_live_akses"]);
  const pimpinan = (cfg || []).some((c) => (c.key === "kantor_ceo" || c.key === "kantor_coo") && c.value === s.id);
  let akses: string[] = [];
  try { akses = JSON.parse(String((cfg || []).find((c) => c.key === "lab_live_akses")?.value || "[]")); } catch { /* kosong */ }
  return { id: s.id as string, nama: s.nama as string, pimpinan, boleh: pimpinan || akses.includes(s.id) };
}

const jamWib = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());

async function dengar(b64: string, tipe: string, kosakata: string) {
  if (!b64 || !GROQ_KEY) return "";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length < 2000) return "";
  const f = new FormData();
  f.append("file", new Blob([bytes], { type: tipe }), "suara." + (tipe.includes("mp4") ? "mp4" : tipe.includes("ogg") ? "ogg" : "webm"));
  f.append("model", "whisper-large-v3-turbo");
  f.append("language", "id");
  f.append("temperature", "0");
  f.append("response_format", "verbose_json");
  f.append("prompt", kosakata);
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + GROQ_KEY }, body: f });
  if (!r.ok) { console.error("groq", r.status, (await r.text()).slice(0, 200)); return ""; }
  const j = await r.json();
  return (j.segments || []).filter((s: any) => s.no_speech_prob < 0.8).map((s: any) => String(s.text || "").trim()).filter(Boolean).join(" ");
}

const SKEMA = {
  type: "object",
  properties: {
    terbaca: { type: "boolean", description: "false kalau gambar bukan dashboard live atau angka tidak terlihat" },
    gmv: { type: ["number", "null"], description: "GMV live saat ini dalam rupiah penuh (402.75K = 402750)" },
    penonton_sekarang: { type: ["number", "null"], description: "jumlah penonton yang sedang menonton sekarang (online/concurrent)" },
    penonton_total: { type: ["number", "null"] },
    terjual: { type: ["number", "null"] },
    klik_produk: { type: ["number", "null"] },
    komentar: { type: "array", items: { type: "string" }, description: "komentar penonton yang terlihat di layar, persis" },
    pertanyaan: { type: "array", items: { type: "string" }, description: "pertanyaan penonton dari komentar, diringkas jadi pertanyaan umum (misal 'harga berapa', 'cocok kulit berminyak?')" },
    bahaya: { type: "array", items: { type: "object", properties: { kutipan: { type: "string" }, alasan: { type: "string" } }, required: ["kutipan", "alasan"] }, description: "kalimat host yang berbahaya; kosong kalau tidak ada" },
  },
  required: ["terbaca", "komentar", "pertanyaan", "bahaya"],
};

async function baca(gambarB64: string, teks: string) {
  const content: any[] = [];
  if (gambarB64) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: gambarB64 } });
  content.push({ type: "text", text: `Ucapan host 30 detik terakhir: ${teks || "(tidak ada suara terdengar)"}` });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1200,
      system: "Kamu membantu operator live TikTok Shop (kategori beauty). Baca angka yang TERLIHAT di screenshot dashboard live; kalau tidak terlihat isi null, jangan menebak. "
        + "Tandai kalimat host yang berbahaya: klaim hasil pasti/berlebihan (pasti hilang, dijamin, 100%, permanen, langsung putih, menyembuhkan), klaim medis, tekanan beli palsu, menjelekkan brand lain, atau melanggar aturan TikTok. Ucapan biasa jangan ditandai. "
        + "Simpan hasil HANYA dengan memanggil alat simpan.",
      tools: [{ name: "simpan", description: "Simpan hasil bacaan.", input_schema: SKEMA }],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Claude " + r.status + " " + JSON.stringify(j).slice(0, 200));
  const blok = (j.content || []).find((x: any) => x.type === "tool_use");
  return { hasil: blok?.input || { terbaca: false, komentar: [], pertanyaan: [], bahaya: [] }, masuk: j.usage?.input_tokens || 0, keluar: j.usage?.output_tokens || 0 };
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Aturan peringatan: semuanya dihitung dari bacaan, bukan pendapat AI (kecuali kalimat berbahaya)
function periksa(kini: any, lalu: any[], detik: number, kataAkun: string[]) {
  const p: any[] = [];
  const pernah = (jenis: string) => lalu.some((t) => detik - t.detik < (JEDA[jenis] || 0) && (t.peringatan || []).some((x: any) => x.jenis === jenis));
  for (const b of kini.angka?.bahaya || []) p.push({ jenis: "bahaya", tingkat: "merah", judul: "Kalimat berbahaya", isi: `"${b.kutipan}" — ${b.alasan}. Minta host meralat.` });

  const pn = kini.angka?.penonton_sekarang;
  const jendela = lalu.filter((t) => detik - t.detik <= ANJLOK_JENDELA && t.angka?.penonton_sekarang != null);
  if (pn != null && jendela.length >= 2 && !pernah("anjlok")) {
    const puncak = Math.max(...jendela.map((t) => t.angka.penonton_sekarang));
    const turun = puncak ? Math.round(((puncak - pn) / puncak) * 100) : 0;
    if (turun >= ANJLOK_PERSEN) p.push({ jenis: "anjlok", tingkat: "merah", judul: `Penonton turun ${turun}%`, isi: `Dari ${puncak} ke ${pn} dalam 3 menit. Ganti topik: tunjukkan produk, sebut harga promo, atau ajak komentar.` });
  }

  const gmv = kini.angka?.gmv;
  if (gmv != null && !pernah("gmv_diam")) {
    const awal = lalu.find((t) => detik - t.detik >= GMV_DIAM_DETIK && t.angka?.gmv != null); // bacaan paling baru yang sudah ≥10 menit lalu (lalu: terbaru dulu)
    if (awal && gmv <= awal.angka.gmv) p.push({ jenis: "gmv_diam", tingkat: "kuning", judul: "GMV diam 10 menit", isi: "Belum ada penjualan baru. Saatnya ajakan beli: sebut harga, batas waktu, nomor keranjang." });
  }

  const kata = [...KATA_JUALAN, ...kataAkun];
  const jendelaJual = [kini, ...lalu.filter((t) => detik - t.detik < TANPA_JUALAN_DETIK)];
  const adaSuara = jendelaJual.filter((t) => (t.teks || "").trim()).length;
  const cukupLama = lalu.some((t) => detik - t.detik >= TANPA_JUALAN_DETIK);
  if (cukupLama && adaSuara >= 6 && !pernah("tanpa_jualan")) {
    const jualan = jendelaJual.some((t) => kata.some((k) => normal(t.teks || "").includes(k)));
    if (!jualan) p.push({ jenis: "tanpa_jualan", tingkat: "kuning", judul: "5 menit tidak jualan", isi: "Host belum menyebut produk, harga, atau keranjang. Arahkan balik ke produk." });
  }

  if (!pernah("pertanyaan")) {
    const hitung: Record<string, { teks: string; n: number }> = {};
    for (const t of [kini, ...lalu.filter((x) => detik - x.detik <= 120)]) for (const q of t.komentar?.pertanyaan || []) { const k = normal(q); if (!k) continue; (hitung[k] ||= { teks: q, n: 0 }).n++; }
    const sering = Object.values(hitung).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)[0];
    if (sering) p.push({ jenis: "pertanyaan", tingkat: "biru", judul: "Penonton bertanya", isi: `"${sering.teks}" muncul ${sering.n}× dalam 2 menit. Minta host menjawab.` });
  }
  return p;
}

Deno.serve(async (req) => {
  const o = req.headers.get("origin") || "";
  const h = { ...cors(o), "content-type": "application/json" };
  const balas = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });
  let b: any = {};
  try { b = await req.json(); } catch { return balas({ galat: "FORMAT" }, 400); }
  const staff = await staffDari(req);
  if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
  if (!staff.boleh) return balas({ galat: "TANPA_AKSES" }, 403);

  try {
    if (b.aksi === "mulai") {
      const { data: akun } = await db.from("lab_akun").select("id").eq("id", b.akun_id).eq("aktif", true).maybeSingle();
      if (!akun) return balas({ galat: "AKUN" }, 400);
      const { data: p, error } = await db.from("lab_pantau").insert({ akun_id: akun.id, host_id: b.host_id || null, dibuat_oleh: staff.id }).select("id, mulai").single();
      if (error) throw error;
      return balas(p);
    }

    if (b.aksi === "kirim") {
      const { data: p } = await db.from("lab_pantau").select("id, akun_id, mulai, status, token_masuk, token_keluar").eq("id", b.id).single();
      if (!p || p.status !== "jalan") return balas({ galat: "STATUS" }, 409);
      const gambar = String(b.gambar || ""), audio = String(b.audio || "");
      if (gambar.length > 3_000_000 || audio.length > 3_000_000) return balas({ galat: "BESAR" }, 400);
      const detik = Math.max(0, Math.round((Date.now() - new Date(p.mulai).getTime()) / 1000));
      const { data: akun } = await db.from("lab_akun").select("nama, kosakata").eq("id", p.akun_id).maybeSingle();
      const kataAkun = String(akun?.kosakata || "").split(/[,\n]/).map((x) => normal(x)).filter((x) => x.length >= 3);
      const teks = await dengar(audio, String(b.tipe || "audio/webm").split(";")[0], `Live TikTok ${akun?.nama || ""}. ${akun?.kosakata || ""}`.slice(0, 600));
      const { hasil, masuk, keluar } = await baca(gambar, teks);
      const angka = { gmv: hasil.gmv ?? null, penonton_sekarang: hasil.penonton_sekarang ?? null, penonton_total: hasil.penonton_total ?? null, terjual: hasil.terjual ?? null, klik_produk: hasil.klik_produk ?? null, terbaca: !!hasil.terbaca, bahaya: hasil.bahaya || [] };
      const komentar = { teks: (hasil.komentar || []).slice(0, 20), pertanyaan: (hasil.pertanyaan || []).slice(0, 10) };
      const { data: lalu } = await db.from("lab_pantau_titik").select("detik, angka, teks, komentar, peringatan").eq("pantau_id", p.id).order("detik", { ascending: false }).limit(40);
      const peringatan = periksa({ angka, teks, komentar }, lalu || [], detik, kataAkun);
      await db.from("lab_pantau_titik").insert({ pantau_id: p.id, detik, jam: jamWib(), angka, teks, komentar, peringatan });
      await db.from("lab_pantau").update({ token_masuk: p.token_masuk + masuk, token_keluar: p.token_keluar + keluar }).eq("id", p.id);
      return balas({ detik, angka, teks, pertanyaan: komentar.pertanyaan, peringatan });
    }

    if (b.aksi === "selesai") {
      await db.from("lab_pantau").update({ status: "selesai", selesai: new Date().toISOString() }).eq("id", b.id).eq("status", "jalan");
      const { data: t } = await db.from("lab_pantau_titik").select("peringatan").eq("pantau_id", b.id);
      const jumlah: Record<string, number> = {};
      for (const x of t || []) for (const q of x.peringatan || []) jumlah[q.jenis] = (jumlah[q.jenis] || 0) + 1;
      return balas({ ok: true, titik: (t || []).length, peringatan: jumlah });
    }

    if (b.aksi === "riwayat") {
      const { data } = await db.from("lab_pantau").select("id, akun_id, host_id, tanggal, mulai, selesai, status").order("mulai", { ascending: false }).limit(30);
      return balas({ pantau: data || [] });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    console.error("lab-pantau", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
