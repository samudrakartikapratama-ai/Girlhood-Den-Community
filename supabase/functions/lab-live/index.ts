// Lab Live: bedah replay live TikTok (复盘). Browser studio mengirim suara (mp3 per 10 menit), lembar foto
// (12 foto tiap 15 detik = 3 menit per lembar), screenshot grafik, screenshot lain (sumber penonton, produk), dan file ekspor.
// Server memproses bertahap (satu tahap per panggilan, berantai sendiri + cron tiap menit sebagai cadangan):
// transkrip (Groq Whisper) → angka (rumus, tanpa AI) → grafik (baca gambar + dicek ke ekspor) → layar → topik → analisis → visual.
// Prinsip akurasi: angka & rasio dihitung kode; AI hanya membaca gambar/ucapan dan menjelaskan sebab.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const KUNCI_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_SB, KUNCI_SR, { auth: { persistSession: false } });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const LARK = "https://open.larksuite.com";
const LARK_ID = Deno.env.get("LARK_APP_ID") || "cli_aa5449215938df0a";
const LARK_SECRET = Deno.env.get("LARK_APP_SECRET") || "";
const BUCKET = "lab-live";
const AUDIO_DETIK = 600; // panjang satu potongan suara
const LEMBAR_DETIK = 180; // satu lembar foto = 12 foto × 15 detik
const MODEL = "claude-sonnet-5-5";
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});

// Patokan awal sebelum akun punya cukup riwayat: model 五维四率 live beauty berbayar (woshipm, 2025).
// Diganti otomatis dengan median akun sendiri setelah minimal 5 live selesai.
const PATOKAN_AWAL = { masuk: 12, klik_produk: 18, bayar: 5 };
const MIN_LIVE_PATOKAN = 5;

// ---------- akses ----------
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
async function dariMesin(req: Request) {
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth && auth === KUNCI_SR) return true;
  const kunci = req.headers.get("x-kantor-kunci");
  if (!kunci) return false;
  const { data } = await db.rpc("kantor_cek_kunci_olah", { p_kunci: kunci });
  return data === true;
}

// ---------- alat bantu ----------
const mmss = (d: number) => { d = Math.max(0, Math.round(d)); const j = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = d % 60; return (j ? j + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0"); };
const pakai = { masuk: 0, keluar: 0 }; // token Claude dalam satu panggilan tahap

async function claudeJson(system: string, content: any, schema: any, max_tokens = 8000) {
  let galat: unknown;
  for (let coba = 0; coba < 2; coba++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL, max_tokens,
          system: system + "\n\nSimpan hasilmu HANYA dengan memanggil alat simpan. Jangan menulis jawaban di luar alat itu.",
          tools: [{ name: "simpan", description: "Simpan hasil.", input_schema: schema }],
          tool_choice: { type: "auto" },
          messages: [{ role: "user", content }],
        }),
      });
      const teks = await r.text();
      if (!r.ok) throw new Error("Claude " + r.status + " " + teks.slice(0, 200));
      const j = JSON.parse(teks);
      pakai.masuk += j.usage?.input_tokens || 0;
      pakai.keluar += j.usage?.output_tokens || 0;
      const blok = (j.content || []).find((b: any) => b.type === "tool_use");
      if (!blok?.input) throw new Error("Claude tanpa hasil (" + j.stop_reason + ")");
      return blok.input;
    } catch (e) { galat = e; }
  }
  throw galat;
}

async function unduhBase64(path: string) {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("unduh " + path + ": " + (error?.message || "kosong"));
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const tipe = ["image/png", "image/jpeg", "image/webp"].includes(data.type) ? data.type : "image/jpeg";
  return { b64: btoa(bin), tipe };
}
async function gambarBlok(prefix: string, n: number, label: string) {
  const blok: any[] = [];
  for (let i = 0; i < n; i++) {
    try { const g = await unduhBase64(`${prefix}/${i}`); blok.push({ type: "text", text: `${label} ${i + 1}:` }, { type: "image", source: { type: "base64", media_type: g.tipe, data: g.b64 } }); } catch { /* gambar hilang: lewati */ }
  }
  return blok;
}

async function kirimLark(teks: string) {
  try {
    const { data: cfg } = await db.from("app_config").select("value").eq("key", "aura_rekap_penerima").maybeSingle();
    const daftar: { open_id: string }[] = JSON.parse(String(cfg?.value || "[]"));
    const t = await fetch(LARK + "/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: LARK_ID, app_secret: LARK_SECRET }) }).then((r) => r.json());
    for (const p of daftar) {
      await fetch(LARK + "/open-apis/im/v1/messages?receive_id_type=open_id", {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8", authorization: "Bearer " + t.tenant_access_token },
        body: JSON.stringify({ receive_id: p.open_id, msg_type: "text", content: JSON.stringify({ text: teks.slice(0, 3800) }) }),
      });
    }
  } catch (e) { console.error("lark", e); }
}

// ---------- angka dari ekspor: dihitung rumus, bukan AI ----------
// "Rp3.120.000" → 3120000, "12,4%" → 12.4, "1.2K" → 1200, "1,234" → 1234
function angkaDari(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/rp|idr|%|\s/gi, "");
  if (!s || /^-+$/.test(s)) return null;
  let kali = 1;
  const akhiran = s.match(/([kmb])$/i);
  if (akhiran) { kali = { k: 1e3, m: 1e6, b: 1e9 }[akhiran[1].toLowerCase() as "k" | "m" | "b"]; s = s.slice(0, -1); }
  const titik = s.lastIndexOf("."), koma = s.lastIndexOf(",");
  if (titik >= 0 && koma >= 0) s = titik > koma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (titik >= 0) s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  else if (koma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n * kali : null;
}
const KOLOM: Record<string, RegExp[]> = {
  waktu: [/^(time|waktu|jam|periode)/i],
  gmv: [/^(attributed |live )?gmv$/i, /gmv/i],
  terjual: [/items? sold/i, /terjual/i],
  pembeli: [/buyers?|customers?|pembeli/i],
  pesanan: [/orders?|pesanan/i],
  tayang: [/^(live )?impressions?$/i, /^tayangan( live)?$/i, /exposure/i],
  penonton: [/^(unique )?viewers?$/i, /^penonton/i],
  tontonan: [/^views?$/i, /^ditonton$/i],
  produk_tayang: [/product impressions?/i, /tayangan produk/i],
  produk_klik: [/product clicks?/i, /klik produk/i],
  komentar: [/comments?|komentar/i],
  follower: [/new followers?|pengikut baru/i],
};
function cariKolom(kepala: string[]) {
  const peta: Record<string, string> = {};
  const terpakai = new Set<string>();
  for (const [kunci, pola] of Object.entries(KOLOM)) {
    for (const p of pola) {
      const k = kepala.find((h) => !terpakai.has(h) && p.test(h.trim()));
      if (k) { peta[kunci] = k; terpakai.add(k); break; }
    }
  }
  return peta;
}
const persen = (a: number | null, b: number | null) => (a != null && b ? Math.round((a / b) * 1000) / 10 : null);

function hitungAngka(rows: any[] | null) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const peta = cariKolom(Object.keys(rows[0]));
  const ambil = (r: any, k: string) => (peta[k] ? angkaDari(r[peta[k]]) : null);
  // baris total (kalau ekspor punya) dipakai apa adanya; kalau tidak, baris per 30 menit dijumlah
  const iTotal = peta.waktu ? rows.findIndex((r) => /total|jumlah|keseluruhan/i.test(String(r[peta.waktu] ?? ""))) : -1;
  const sesi = rows.filter((_, i) => i !== iTotal);
  const jumlah = (k: string) => { if (!peta[k]) return null; if (iTotal >= 0) return ambil(rows[iTotal], k); const v = sesi.map((r) => ambil(r, k)).filter((x) => x != null) as number[]; return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const t: Record<string, number | null> = {};
  for (const k of Object.keys(KOLOM)) if (k !== "waktu") t[k] = jumlah(k);
  const pembeliDari = t.pembeli != null ? "pembeli" : t.pesanan != null ? "pesanan" : null;
  const pembeli = t.pembeli ?? t.pesanan;
  const rasio = (x: Record<string, number | null>, beli: number | null) => ({
    masuk: persen(x.penonton, x.tayang), // dari yang melihat live di FYP, berapa yang masuk
    lihat_produk: persen(x.produk_tayang, x.penonton), // produk dilihat per penonton (bisa >100%: dihitung per tayang, bukan per orang)
    klik_produk: persen(x.produk_klik, x.produk_tayang), // menarik untuk diklik = kekuatan host menjelaskan
    bayar: persen(beli, x.produk_klik), // dari yang klik, berapa yang bayar = kepercayaan & closing
  });
  const per30 = sesi.map((r) => {
    const x: Record<string, number | null> = {};
    for (const k of Object.keys(KOLOM)) if (k !== "waktu") x[k] = ambil(r, k);
    return { waktu: peta.waktu ? String(r[peta.waktu] ?? "") : "", gmv: x.gmv, penonton: x.penonton, ...rasio(x, x.pembeli ?? x.pesanan) };
  });
  const catatan: string[] = [];
  if (!peta.gmv) catatan.push("kolom GMV tidak ditemukan di ekspor");
  if (pembeliDari === "pesanan") catatan.push("jumlah pembeli tidak ada di ekspor; klik ke bayar memakai jumlah pesanan");
  if (!pembeliDari) catatan.push("jumlah pembeli/pesanan tidak ada; klik ke bayar tidak bisa dihitung");
  if (iTotal < 0 && sesi.length > 1 && (t.penonton != null)) catatan.push("penonton dijumlah dari beberapa baris 30 menit, bisa terhitung dobel (angka perkiraan)");
  return {
    total: { ...t, pembeli }, pembeli_dari: pembeliDari, rasio: rasio(t, pembeli),
    gpm: t.gmv != null && t.tontonan ? Math.round((t.gmv / t.tontonan) * 1000) : null,
    per30, kolom: peta, catatan,
  };
}

async function patokanAkun(akunId: string, kecuali: string) {
  const { data } = await db.from("lab_live").select("angka").eq("akun_id", akunId).eq("status", "selesai").neq("id", kecuali)
    .not("angka", "is", null).order("tanggal", { ascending: false }).limit(30);
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const hasil: Record<string, number> = {}, n: Record<string, number> = {};
  for (const k of ["masuk", "klik_produk", "bayar"] as const) {
    const v = (data || []).map((d: any) => d.angka?.rasio?.[k]).filter((x: any) => typeof x === "number");
    n[k] = v.length;
    hasil[k] = v.length >= MIN_LIVE_PATOKAN ? Math.round(median(v) * 10) / 10 : PATOKAN_AWAL[k];
  }
  const dariAkun = Object.values(n).every((x) => x >= MIN_LIVE_PATOKAN);
  return { ...hasil, sumber: dariAkun ? `median ${Math.min(...Object.values(n))} live terakhir akun ini` : "patokan awal (referensi live beauty China, belum disesuaikan dengan akun ini)" };
}

// Pohon keputusan 五维四率: berhenti di rasio pertama yang di bawah patokan
function pohon(r: any, p: any) {
  const cek = [
    ["masuk", "Trafik: orang melihat live di FYP tapi tidak masuk. Periksa cover, judul, 3 detik pembuka, dan target iklan."],
    ["klik_produk", "Host: penjelasan produk belum membuat orang klik keranjang. Periksa demo, manfaat, dan ajakan klik."],
    ["bayar", "Host: orang sudah klik tapi tidak bayar. Periksa kepercayaan (bukti, testimoni, garansi) dan cara closing."],
  ] as const;
  for (const [k, arti] of cek) {
    if (r?.[k] == null) continue;
    if (r[k] < p[k]) return { titik: k, nilai: r[k], patokan: p[k], arti };
  }
  const ada = cek.some(([k]) => r?.[k] != null);
  return ada ? { titik: null, arti: "Semua rasio di atas patokan. Fokus berikutnya: menambah trafik (jam tayang, iklan, konten pemanas)." } : { titik: null, arti: "Rasio tidak bisa dihitung karena ekspor tidak lengkap." };
}

// ---------- tahap pemrosesan ----------
const URUT_TAHAP = ["transkrip", "angka", "grafik", "layar", "topik", "analisis", "visual"] as const;
const tahapBerikut = (t: string) => URUT_TAHAP[URUT_TAHAP.indexOf(t as any) + 1] || null;

async function tahapTranskrip(l: any) {
  const tr = l.transkrip || { seg: [], selesai: 0 };
  const { data: akun } = await db.from("lab_akun").select("nama, kosakata").eq("id", l.akun_id).maybeSingle();
  // kosakata membantu Whisper menulis nama brand/produk dengan benar
  const kosakata = `Live TikTok ${akun?.nama || ""}. ${akun?.kosakata || ""}`.slice(0, 600);
  const mulai = Date.now();
  while (tr.selesai < l.potongan_audio && Date.now() - mulai < 70_000) {
    const i = tr.selesai;
    const { data: file, error } = await db.storage.from(BUCKET).download(`${l.id}/audio/${i}.mp3`);
    if (error || !file) throw new Error("audio " + i + " tidak ada");
    const f = new FormData();
    f.append("file", new File([file], `${i}.mp3`, { type: "audio/mpeg" }));
    f.append("model", "whisper-large-v3");
    f.append("language", "id");
    f.append("response_format", "verbose_json");
    f.append("temperature", "0");
    f.append("prompt", kosakata);
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + GROQ_KEY }, body: f });
    if (!r.ok) throw new Error("Groq " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    for (const s of j.segments || []) {
      const teks = String(s.text || "").trim();
      if (!teks || s.no_speech_prob > 0.8) continue; // hening/musik yang "dikarang" Whisper
      const ragu = (s.avg_logprob ?? 0) < -1 || (s.compression_ratio ?? 0) > 2.4;
      tr.seg.push({ a: Math.round((s.start + i * AUDIO_DETIK) * 10) / 10, b: Math.round((s.end + i * AUDIO_DETIK) * 10) / 10, t: teks, ...(ragu ? { r: 1 } : {}) });
    }
    tr.selesai++;
  }
  if (tr.selesai >= l.potongan_audio) tr.ragu_persen = tr.seg.length ? Math.round((tr.seg.filter((s: any) => s.r).length / tr.seg.length) * 100) : 0;
  await db.from("lab_live").update({ transkrip: tr }).eq("id", l.id);
  return tr.selesai >= l.potongan_audio;
}

async function tahapAngka(l: any) {
  const a = hitungAngka(l.ekspor);
  if (a) {
    const p = await patokanAkun(l.akun_id, l.id);
    Object.assign(a, { patokan: p, diagnosis: pohon(a.rasio, p) });
  }
  await db.from("lab_live").update({ angka: a }).eq("id", l.id);
  return true;
}

async function tahapGrafik(l: any) {
  if (!l.n_grafik) { await db.from("lab_live").update({ grafik: null }).eq("id", l.id); return true; }
  const gambar = await gambarBlok(`${l.id}/grafik`, l.n_grafik, "Screenshot grafik");
  if (!gambar.length) return true;
  const hasil = await claudeJson(
    "Kamu membaca screenshot grafik 'Performance trends' dashboard live TikTok Shop. Baca setiap titik sedekat mungkin; kalau ada beberapa screenshot, gabungkan per jam. Kalau sebuah nilai tidak terbaca, isi null, jangan menebak. Angka mata uang dalam rupiah penuh (402.75K = 402750). Tentukan juga apakah garis GMV menunjukkan total berjalan (naik terus) atau nilai per interval.",
    [...gambar, { type: "text", text: `Live dimulai jam ${l.jam_mulai || "(tidak diketahui)"}. Baca semua titik grafik.` }],
    {
      type: "object",
      properties: {
        garis: { type: "array", items: { type: "string" }, description: "nama metrik yang tampil di legenda" },
        interval_menit: { type: "integer", description: "jarak antar titik dalam menit" },
        gmv_kumulatif: { type: "boolean", description: "true kalau GMV di grafik adalah total berjalan" },
        titik: { type: "array", items: { type: "object", properties: { jam: { type: "string", description: "HH:MM" }, nilai: { type: "object", additionalProperties: { type: ["number", "null"] }, description: "nama metrik → nilai" } }, required: ["jam", "nilai"] } },
        catatan: { type: "string" },
      },
      required: ["garis", "titik"],
    }, 8000);
  // cek silang: total GMV dari grafik dibanding GMV resmi di ekspor
  const gmvEkspor = l.angka?.total?.gmv;
  const kunciGmv = (hasil.garis || []).find((g: string) => /gmv/i.test(g));
  if (gmvEkspor && kunciGmv) {
    const v = (hasil.titik || []).map((t: any) => t.nilai?.[kunciGmv]).filter((x: any) => typeof x === "number");
    const dariGrafik = v.length ? (hasil.gmv_kumulatif ? Math.max(...v) : v.reduce((a: number, b: number) => a + b, 0)) : null;
    const selisih = dariGrafik != null ? Math.round((Math.abs(dariGrafik - gmvEkspor) / gmvEkspor) * 100) : null;
    hasil.cek = { gmv_grafik: dariGrafik, gmv_ekspor: gmvEkspor, selisih_persen: selisih, status: selisih == null ? "tidak bisa dicek" : selisih <= 15 ? "cocok" : "meragukan" };
  } else hasil.cek = { status: "tidak bisa dicek", alasan: gmvEkspor ? "garis GMV tidak ada di grafik" : "tidak ada GMV di ekspor" };
  await db.from("lab_live").update({ grafik: hasil }).eq("id", l.id);
  return true;
}

async function tahapLayar(l: any) {
  if (!l.n_layar) return true;
  const gambar = await gambarBlok(`${l.id}/layar`, l.n_layar, "Screenshot dashboard");
  if (!gambar.length) return true;
  const hasil = await claudeJson(
    "Kamu membaca screenshot dashboard live TikTok Shop (misalnya sumber penonton, daftar produk, data penonton). Salin angka persis seperti tertulis; jangan menghitung atau menebak. Kalau tidak terbaca, tulis tidak terbaca.",
    [...gambar, { type: "text", text: "Ambil semua angka penting dari screenshot ini." }],
    {
      type: "object",
      properties: {
        sumber_penonton: { type: "array", items: { type: "object", properties: { sumber: { type: "string" }, persen: { type: ["number", "null"] }, jumlah: { type: ["number", "null"] } }, required: ["sumber"] }, description: "contoh: For You, iklan/GMV Max, Following, Search" },
        produk: { type: "array", items: { type: "object", properties: { nama: { type: "string" }, klik: { type: ["number", "null"] }, terjual: { type: ["number", "null"] }, gmv: { type: ["number", "null"] } }, required: ["nama"] } },
        lain: { type: "string", description: "angka penting lain yang terlihat (misal rata-rata durasi tonton, penonton puncak)" },
      },
      required: ["lain"],
    }, 4000);
  await db.from("lab_live").update({ layar: hasil }).eq("id", l.id);
  return true;
}

function teksTranskrip(seg: any[]) {
  return seg.map((s) => `[${mmss(s.a)}]${s.r ? "?" : ""} ${s.t}`).join("\n");
}

async function tahapTopik(l: any) {
  const seg = l.transkrip?.seg || [];
  if (!seg.length) { await db.from("lab_live").update({ topik: [] }).eq("id", l.id); return true; }
  const hasil = await claudeJson(
    "Kamu analis live streaming e-commerce (TikTok Shop, kategori beauty). Potong transkrip ucapan host menjadi topik berurutan yang tidak tumpang-tindih dan menutupi seluruh live. Satu topik = satu kegiatan utuh (membuka live, menjelaskan satu produk, menjawab komentar, promo/flash sale, closing, ngobrol bebas). Panjang wajar 1–8 menit. Baris bertanda ? kurang jelas terdengar. Tulis dalam bahasa Indonesia.",
    `Durasi live: ${mmss(l.durasi_detik || 0)}\nTranskrip (waktu sejak live mulai):\n${teksTranskrip(seg).slice(0, 180000)}`,
    {
      type: "object",
      properties: {
        topik: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mulai: { type: "number", description: "detik sejak live mulai" },
              selesai: { type: "number" },
              jenis: { type: "string", enum: ["pembukaan", "produk", "interaksi", "promo", "closing", "lain"] },
              judul: { type: "string", description: "maksimal 6 kata" },
              produk: { type: "string", description: "nama produk kalau ada, kosong kalau tidak" },
              ringkas: { type: "string", description: "1 kalimat: apa yang host lakukan/katakan" },
            },
            required: ["mulai", "selesai", "jenis", "judul", "ringkas"],
          },
        },
      },
      required: ["topik"],
    }, 12000);
  await db.from("lab_live").update({ topik: hasil.topik || [] }).eq("id", l.id);
  return true;
}

const SKEMA_MOMEN = {
  type: "object",
  properties: {
    jenis: { type: "string", enum: ["terbaik", "terburuk", "bahaya"] },
    mulai: { type: "number", description: "detik sejak live mulai" },
    selesai: { type: "number" },
    judul: { type: "string", description: "maksimal 8 kata" },
    bukti: { type: "string", description: "angka dari grafik/ekspor yang menunjukkan naik/turun, sebut sumbernya; kosong kalau tidak ada" },
    kutipan: { type: "string", description: "ucapan host persis dari transkrip (maks 25 kata)" },
    alasan: { type: "string", description: "1-2 kalimat kenapa momen ini berhasil/gagal/berbahaya" },
    yakin: { type: "string", enum: ["tinggi", "sedang", "rendah"], description: "tinggi = didukung angka per waktu yang cocok; rendah = hanya dari ucapan" },
  },
  required: ["jenis", "mulai", "selesai", "judul", "kutipan", "alasan", "yakin"],
};

async function koreksiSebelumnya(akunId: string) {
  // ulasan "kurang tepat" dari pimpinan pada live sebelumnya: dipakai supaya kesalahan yang sama tidak terulang
  const { data } = await db.from("lab_live").select("laporan, ulasan").eq("akun_id", akunId).eq("status", "selesai").order("selesai_at", { ascending: false }).limit(20);
  const daftar: string[] = [];
  for (const d of data || []) {
    for (const [i, u] of Object.entries(d.ulasan || {}) as [string, any][]) {
      if (u?.nilai !== "kurang" || !u.catatan) continue;
      const m = d.laporan?.momen?.[Number(i)];
      daftar.push(`- AI menilai "${m?.judul || "?"}" (${m?.jenis || "?"}); koreksi pimpinan: ${u.catatan}`);
    }
  }
  return daftar.slice(0, 15).join("\n");
}

async function tahapAnalisis(l: any) {
  const { data: akun } = await db.from("lab_akun").select("nama").eq("id", l.akun_id).maybeSingle();
  const { data: host } = l.host_id ? await db.from("lab_host").select("nama").eq("id", l.host_id).maybeSingle() : { data: null };
  const topik = (l.topik || []).map((t: any) => `${mmss(t.mulai)}–${mmss(t.selesai)} [${t.jenis}] ${t.judul}${t.produk ? " · " + t.produk : ""}: ${t.ringkas}`).join("\n");
  const g = l.grafik;
  const grafik = g?.titik?.length
    ? `Status cek grafik vs ekspor: ${g.cek?.status}${g.cek?.selisih_persen != null ? ` (selisih GMV ${g.cek.selisih_persen}%)` : ""}. Interval ${g.interval_menit || "?"} menit. Garis: ${(g.garis || []).join(", ")}\n`
      + g.titik.map((t: any) => `${t.jam}: ${Object.entries(t.nilai || {}).map(([k, v]) => `${k}=${v ?? "-"}`).join(", ")}`).join("\n")
    : "(tidak ada screenshot grafik: tidak ada angka per waktu, jadi momen hanya bisa dinilai dari ucapan dan angka per 30 menit)";
  const a = l.angka;
  const angka = a ? `TOTAL (dihitung sistem dari ekspor, JANGAN dihitung ulang): ${JSON.stringify(a.total)}
RASIO % (dihitung sistem): ${JSON.stringify(a.rasio)}
PATOKAN (${a.patokan?.sumber}): masuk ${a.patokan?.masuk}%, klik produk ${a.patokan?.klik_produk}%, klik ke bayar ${a.patokan?.bayar}%
DIAGNOSIS POHON KEPUTUSAN (sistem): ${a.diagnosis?.arti}
PER 30 MENIT: ${JSON.stringify(a.per30)}
Catatan data: ${(a.catatan || []).join("; ") || "-"}` : "(tidak ada file ekspor: tidak ada angka resmi)";
  const koreksi = await koreksiSebelumnya(l.akun_id);
  const isi = `Akun: ${akun?.nama || "?"} · Host: ${host?.nama || "?"} · Tanggal ${l.tanggal} · Mulai jam ${l.jam_mulai || "?"} · Durasi ${mmss(l.durasi_detik || 0)}
Catatan orang di studio: ${l.catatan || "-"}

ANGKA RESMI
${angka}

DASHBOARD LAIN (dibaca dari screenshot): ${l.layar ? JSON.stringify(l.layar) : "-"}

GRAFIK (dibaca dari screenshot, perkiraan; jam = jam dinding):
${grafik}

TOPIK (waktu = sejak live mulai; jam dinding = jam mulai + waktu):
${topik}

TRANSKRIP (baris bertanda ? kurang jelas terdengar, jangan dijadikan kutipan utama):
${teksTranskrip(l.transkrip?.seg || []).slice(0, 150000)}`;
  const hasil = await claudeJson(
    `Kamu kepala tim live di MCN TikTok beauty Girlhood Den, terbiasa 复盘 ala MCN China (人货场 + 五维四率). Tugasmu menjelaskan SEBAB di balik angka dengan mencocokkan ucapan/topik host dengan naik-turun angka per waktu.
Aturan akurasi:
- Semua total dan rasio sudah dihitung sistem. Pakai angka itu apa adanya, jangan menghitung rasio baru.
- Diagnosis harus mengikuti pohon keputusan sistem; tugasmu memberi bukti dari ucapan/topik yang menjelaskan kenapa titik itu lemah.
- Momen "terbaik/terburuk" hanya boleh disebut naik/turun kalau ada angka per waktu yang mendukung (grafik atau per 30 menit). Kalau tidak ada, nilai dari kualitas ucapan saja dan beri yakin "rendah".
- Kalau status cek grafik "meragukan", jangan bersandar pada angka grafik.
- Kalimat berbahaya = klaim berlebihan/menyesatkan (misal "pasti hilang dalam 3 hari"), tekanan beli palsu, janji yang tidak bisa dipenuhi, atau melanggar aturan TikTok.
- Kutipan harus persis dari transkrip.
${koreksi ? "Koreksi pimpinan atas penilaianmu di live sebelumnya (jangan ulangi kesalahan yang sama):\n" + koreksi : ""}
Bahasa Indonesia sehari-hari, lugas.`,
    isi,
    {
      type: "object",
      properties: {
        ringkas: { type: "string", description: "maksimal 3 kalimat: bagaimana live ini secara keseluruhan" },
        momen: { type: "array", items: SKEMA_MOMEN, description: "maksimal 3 terbaik, 3 terburuk, dan semua kalimat bahaya (maks 5)" },
        diagnosis: { type: "string", description: "jelaskan diagnosis pohon keputusan sistem dengan bukti dari ucapan/topik" },
        saran: { type: "array", items: { type: "string" }, description: "maksimal 3 saran konkret untuk live berikutnya; satu saran = satu hal yang diubah, sebaiknya di titik lemah pohon" },
      },
      required: ["ringkas", "momen", "diagnosis", "saran"],
    }, 8000);
  await db.from("lab_live").update({ laporan: hasil }).eq("id", l.id);
  return true;
}

async function tahapVisual(l: any) {
  const lap = l.laporan || {};
  const momen = (lap.momen || []).filter((m: any) => m.jenis !== "bahaya").slice(0, 6);
  const idx = [...new Set(momen.map((m: any) => Math.min(Math.max(0, l.lembar - 1), Math.floor(m.mulai / LEMBAR_DETIK))))].slice(0, 6) as number[];
  if (!idx.length || !l.lembar) return true;
  const gambar: any[] = [];
  for (const i of idx) {
    try { const g = await unduhBase64(`${l.id}/lembar/${i}.jpg`); gambar.push({ type: "text", text: `Lembar ${i}: menit ${mmss(i * LEMBAR_DETIK)}–${mmss((i + 1) * LEMBAR_DETIK)} (12 foto, tiap 15 detik, kiri ke kanan lalu ke bawah; tiap foto ada label waktunya)` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: g.b64 } }); } catch { /* lembar hilang: lewati */ }
  }
  if (!gambar.length) return true;
  const daftar = momen.map((m: any, k: number) => `${k}. [${m.jenis}] ${mmss(m.mulai)}–${mmss(m.selesai)} ${m.judul}`).join("\n");
  const hasil = await claudeJson(
    "Kamu melihat foto-foto layar live TikTok beauty. Untuk setiap momen, jelaskan apa yang terlihat (人货场): gerakan dan ekspresi host, produk yang dipegang, demo atau tidak, tulisan/stiker/harga di layar, set dan pencahayaan. Hanya yang benar-benar terlihat; jangan menebak. Bahasa Indonesia, 1-2 kalimat per momen.",
    [...gambar, { type: "text", text: "Momen yang perlu dijelaskan:\n" + daftar }],
    { type: "object", properties: { visual: { type: "array", items: { type: "object", properties: { no: { type: "integer" }, terlihat: { type: "string" } }, required: ["no", "terlihat"] } } }, required: ["visual"] }, 3000);
  for (const v of hasil.visual || []) if (momen[v.no]) momen[v.no].visual = v.terlihat;
  await db.from("lab_live").update({ laporan: lap }).eq("id", l.id);
  return true;
}

async function selesaikan(l: any) {
  await db.from("lab_live").update({ status: "selesai", tahap: null, selesai_at: new Date().toISOString(), galat: null }).eq("id", l.id);
  if (String(l.catatan || "").startsWith("[uji]")) return; // uji sistem: tanpa pesan Lark
  const { data: akun } = await db.from("lab_akun").select("nama").eq("id", l.akun_id).maybeSingle();
  const { data: host } = l.host_id ? await db.from("lab_host").select("nama").eq("id", l.host_id).maybeSingle() : { data: null };
  const lap = l.laporan || {};
  const ikon: Record<string, string> = { terbaik: "🟢", terburuk: "🔴", bahaya: "⚠️" };
  await kirimLark(`Lab Live · ${akun?.nama || "?"} · ${host?.nama || "host ?"} · ${l.tanggal}\n\n${lap.ringkas || ""}\n\n`
    + (l.angka?.diagnosis?.arti ? `Titik lemah: ${l.angka.diagnosis.arti}\n\n` : "")
    + (lap.momen || []).slice(0, 8).map((m: any) => `${ikon[m.jenis] || "•"} ${mmss(m.mulai)} ${m.judul}`).join("\n")
    + (lap.saran?.length ? `\n\nLive berikutnya:\n- ${lap.saran.join("\n- ")}` : "")
    + `\n\nLaporan lengkap: girlhoodden.com/aura → Lab Live`);
}

// Proses satu tahap untuk satu live. Mengembalikan true kalau masih ada pekerjaan.
async function jalankanSatu(id?: string) {
  const basi = new Date(Date.now() - 6 * 60_000).toISOString();
  let calon: { id: string }[] | null;
  if (id) ({ data: calon } = await db.from("lab_live").select("id").eq("id", id).eq("status", "antre").limit(1));
  else {
    ({ data: calon } = await db.from("lab_live").select("id").eq("status", "antre").order("dibuat_at").limit(1));
    // tahap yang macet (fungsi mati di tengah jalan) diambil lagi setelah 6 menit
    if (!calon?.length) ({ data: calon } = await db.from("lab_live").select("id").eq("status", "proses").lt("tahap_at", basi).order("dibuat_at").limit(1));
  }
  if (!calon?.length) return false;
  // klaim baris supaya tidak diproses dua kali
  const { data: klaim } = await db.from("lab_live").update({ status: "proses", tahap_at: new Date().toISOString() }).eq("id", calon[0].id).in("status", ["antre", "proses"]).select("*").single();
  if (!klaim) return false;
  const l = klaim;
  const tahap = l.tahap || "transkrip";
  pakai.masuk = 0; pakai.keluar = 0;
  try {
    const fungsi: Record<string, (l: any) => Promise<boolean>> = { transkrip: tahapTranskrip, angka: tahapAngka, grafik: tahapGrafik, layar: tahapLayar, topik: tahapTopik, analisis: tahapAnalisis, visual: tahapVisual };
    const tuntas = await fungsi[tahap](l);
    const berikut = tuntas ? tahapBerikut(tahap) : tahap;
    const token = { token_masuk: (l.token_masuk || 0) + pakai.masuk, token_keluar: (l.token_keluar || 0) + pakai.keluar };
    if (!berikut) {
      await db.from("lab_live").update(token).eq("id", l.id);
      const { data: segar } = await db.from("lab_live").select("*").eq("id", l.id).single();
      await selesaikan(segar);
      return true;
    }
    await db.from("lab_live").update({ status: "antre", tahap: berikut, coba: 0, galat: null, ...token }).eq("id", l.id);
    return true;
  } catch (e) {
    const pesan = String((e as Error)?.message || e).slice(0, 500);
    console.error("lab-live", l.id, tahap, pesan);
    const coba = (l.coba || 0) + 1;
    await db.from("lab_live").update({ status: coba >= 3 ? "gagal" : "antre", coba, galat: `${tahap}: ${pesan}` }).eq("id", l.id);
    return coba < 3;
  }
}

function sambungLagi() {
  // panggil diri sendiri untuk tahap berikutnya (tidak ditunggu); cron tiap menit jadi cadangan
  const kerja = fetch(URL_SB + "/functions/v1/lab-live", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + KUNCI_SR }, body: JSON.stringify({ aksi: "jalan" }) }).catch(() => {});
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(kerja);
}

const jalurFile = (l: any) => [
  ...Array.from({ length: l.potongan_audio }, (_, i) => `audio/${i}.mp3`),
  ...Array.from({ length: l.lembar }, (_, i) => `lembar/${i}.jpg`),
  ...Array.from({ length: l.n_grafik }, (_, i) => `grafik/${i}`),
  ...Array.from({ length: l.n_layar }, (_, i) => `layar/${i}`),
];

// ---------- server ----------
Deno.serve(async (req) => {
  const o = req.headers.get("origin") || "";
  const h = { ...cors(o), "content-type": "application/json" };
  const balas = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });
  let b: any = {};
  try { b = await req.json(); } catch { return balas({ galat: "FORMAT" }, 400); }

  if (b.aksi === "jalan") {
    if (!(await dariMesin(req))) return balas({ galat: "TERLARANG" }, 403);
    const ada = await jalankanSatu();
    if (ada) sambungLagi();
    return balas({ ok: true, ada });
  }

  const staff = await staffDari(req);
  if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
  if (!staff.boleh) return balas({ galat: "TANPA_AKSES" }, 403);

  try {
    if (b.aksi === "status") {
      const [{ data: akun }, { data: host }, { data: live }] = await Promise.all([
        db.from("lab_akun").select("*").order("nama"),
        db.from("lab_host").select("*").order("nama"),
        db.from("lab_live").select("id, akun_id, host_id, tanggal, jam_mulai, durasi_detik, status, tahap, galat, dibuat_at, selesai_at, angka, ulasan").order("tanggal", { ascending: false }).order("dibuat_at", { ascending: false }).limit(200),
      ]);
      const out: any = { pimpinan: staff.pimpinan, akun, host, live: (live || []).map((x: any) => ({ ...x, angka: x.angka ? { total: x.angka.total, rasio: x.angka.rasio, gpm: x.angka.gpm, titik: x.angka.diagnosis?.titik } : null })) };
      if (staff.pimpinan) {
        const { data: orang } = await db.from("internal_staff").select("id, nama").eq("is_active", true).order("nama");
        const { data: cfg } = await db.from("app_config").select("value").eq("key", "lab_live_akses").maybeSingle();
        let akses: string[] = []; try { akses = JSON.parse(String(cfg?.value || "[]")); } catch { /* */ }
        out.orang = (orang || []).map((p) => ({ ...p, akses: akses.includes(p.id) }));
      }
      return balas(out);
    }

    if (b.aksi === "akun-simpan" || b.aksi === "host-simpan") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const tabel = b.aksi === "akun-simpan" ? "lab_akun" : "lab_host";
      const nama = String(b.nama || "").trim().slice(0, 80);
      if (!nama) return balas({ galat: "NAMA_KOSONG" }, 400);
      const isi: any = { nama, aktif: b.aktif !== false };
      if (tabel === "lab_akun") { isi.laboratorium = !!b.laboratorium; if (b.kosakata !== undefined) isi.kosakata = String(b.kosakata || "").slice(0, 600) || null; }
      else isi.akun_id = b.akun_id || null;
      const q = b.id ? db.from(tabel).update(isi).eq("id", b.id) : db.from(tabel).insert(isi);
      const { error } = await q;
      if (error) throw error;
      return balas({ ok: true });
    }

    if (b.aksi === "akses-simpan") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const ids = (Array.isArray(b.staff_ids) ? b.staff_ids : []).filter((x: unknown) => typeof x === "string").slice(0, 50);
      await db.from("app_config").upsert({ key: "lab_live_akses", value: JSON.stringify(ids) });
      return balas({ ok: true });
    }

    if (b.aksi === "buat") {
      const { data: akun } = await db.from("lab_akun").select("id").eq("id", b.akun_id).eq("aktif", true).maybeSingle();
      if (!akun) return balas({ galat: "AKUN" }, 400);
      const nAudio = Math.min(40, Math.max(0, Number(b.potongan_audio) || 0));
      const nLembar = Math.min(150, Math.max(0, Number(b.lembar) || 0));
      const nGrafik = Math.min(3, Math.max(0, Number(b.n_grafik) || 0));
      const nLayar = Math.min(4, Math.max(0, Number(b.n_layar) || 0));
      if (!nAudio) return balas({ galat: "TANPA_SUARA" }, 400);
      if (!/^\d{2}:\d{2}$/.test(String(b.jam_mulai || ""))) return balas({ galat: "JAM_MULAI" }, 400);
      const ekspor = Array.isArray(b.ekspor) ? b.ekspor.slice(0, 500) : null;
      const { data: l, error } = await db.from("lab_live").insert({
        akun_id: akun.id, host_id: b.host_id || null, tanggal: String(b.tanggal || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
        jam_mulai: String(b.jam_mulai).slice(0, 5), durasi_detik: Math.round(Number(b.durasi_detik) || 0),
        catatan: String(b.catatan || "").slice(0, 3000) || null, ekspor, potongan_audio: nAudio, lembar: nLembar,
        n_grafik: nGrafik, n_layar: nLayar, dibuat_oleh: staff.id,
      }).select("*").single();
      if (error) throw error;
      const token: Record<string, string> = {};
      for (const p of jalurFile(l)) {
        const { data: s, error: e2 } = await db.storage.from(BUCKET).createSignedUploadUrl(`${l.id}/${p}`);
        if (e2 || !s) throw e2 || new Error("signed url");
        token[p] = s.token;
      }
      return balas({ id: l.id, token });
    }

    if (b.aksi === "siap") {
      const { data: l } = await db.from("lab_live").select("id, status, potongan_audio").eq("id", b.id).single();
      if (!l || l.status !== "unggah") return balas({ galat: "STATUS" }, 409);
      const { data: audio } = await db.storage.from(BUCKET).list(`${l.id}/audio`, { limit: 100 });
      if ((audio || []).length < l.potongan_audio) return balas({ galat: "SUARA_BELUM_LENGKAP", ada: (audio || []).length }, 409);
      await db.from("lab_live").update({ status: "antre", tahap: "transkrip" }).eq("id", l.id);
      const kerja = jalankanSatu(l.id).then((ada) => { if (ada) sambungLagi(); }).catch((e) => console.error("siap", e));
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(kerja);
      return balas({ ok: true });
    }

    if (b.aksi === "detail") {
      const { data: l } = await db.from("lab_live").select("*").eq("id", b.id).single();
      if (!l) return balas({ galat: "TIDAK_ADA" }, 404);
      const tanda = async (prefix: string, n: number, ext = "") => {
        if (!n) return [];
        const { data: s } = await db.storage.from(BUCKET).createSignedUrls(Array.from({ length: n }, (_, i) => `${l.id}/${prefix}/${i}${ext}`), 6 * 3600);
        return (s || []).map((x: any) => x.signedUrl || null);
      };
      const [url_lembar, url_grafik, url_layar] = await Promise.all([tanda("lembar", l.lembar, ".jpg"), tanda("grafik", l.n_grafik), tanda("layar", l.n_layar)]);
      const out: any = { ...l, ekspor: undefined, url_lembar, url_grafik, url_layar, lembar_detik: LEMBAR_DETIK };
      if (!staff.pimpinan) { delete out.token_masuk; delete out.token_keluar; }
      return balas(out);
    }

    if (b.aksi === "ulas") {
      const i = Number(b.momen);
      if (!Number.isInteger(i) || i < 0 || !["tepat", "kurang"].includes(b.nilai)) return balas({ galat: "FORMAT" }, 400);
      const { data: l } = await db.from("lab_live").select("ulasan").eq("id", b.id).single();
      if (!l) return balas({ galat: "TIDAK_ADA" }, 404);
      const ulasan = { ...(l.ulasan || {}), [i]: { nilai: b.nilai, catatan: String(b.catatan || "").slice(0, 500) || null, oleh: staff.nama, at: new Date().toISOString() } };
      await db.from("lab_live").update({ ulasan }).eq("id", b.id);
      return balas({ ok: true, ulasan });
    }

    if (b.aksi === "ulang") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      await db.from("lab_live").update({ status: "antre", coba: 0, galat: null }).eq("id", b.id).eq("status", "gagal");
      sambungLagi();
      return balas({ ok: true });
    }

    if (b.aksi === "hapus") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const { data: l } = await db.from("lab_live").select("id, potongan_audio, lembar, n_grafik, n_layar").eq("id", b.id).single();
      if (!l) return balas({ ok: true });
      await db.storage.from(BUCKET).remove(jalurFile(l).map((p) => `${l.id}/${p}`));
      await db.from("lab_live").delete().eq("id", l.id);
      return balas({ ok: true });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    console.error("lab-live", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
