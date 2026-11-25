// Lab Live: bedah replay live TikTok. Browser studio mengirim suara (mp3 per 10 menit), lembar foto
// (12 foto tiap 15 detik = 3 menit per lembar), screenshot grafik 5 menit, dan file ekspor 30 menit.
// Server memproses bertahap (satu tahap per panggilan, berantai sendiri + cron tiap menit sebagai cadangan):
// transkrip (Groq Whisper) → grafik (baca gambar) → topik (potong ucapan per topik) → analisis → visual → selesai.
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
  return { b64: btoa(bin), tipe: data.type || "image/jpeg" };
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

// ---------- tahap pemrosesan ----------
const URUT_TAHAP = ["transkrip", "grafik", "topik", "analisis", "visual"] as const;
const tahapBerikut = (t: string) => URUT_TAHAP[URUT_TAHAP.indexOf(t as any) + 1] || null;

async function tahapTranskrip(l: any) {
  const tr = l.transkrip || { seg: [], selesai: 0 };
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
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + GROQ_KEY }, body: f });
    if (!r.ok) throw new Error("Groq " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    for (const s of j.segments || []) {
      const teks = String(s.text || "").trim();
      if (teks) tr.seg.push({ a: Math.round((s.start + i * AUDIO_DETIK) * 10) / 10, b: Math.round((s.end + i * AUDIO_DETIK) * 10) / 10, t: teks });
    }
    tr.selesai++;
  }
  await db.from("lab_live").update({ transkrip: tr }).eq("id", l.id);
  return tr.selesai >= l.potongan_audio; // selesai atau perlu lanjut di panggilan berikutnya
}

async function tahapGrafik(l: any) {
  if (!l.ada_grafik) { await db.from("lab_live").update({ grafik: null }).eq("id", l.id); return true; }
  const img = await unduhBase64(`${l.id}/grafik`);
  const hasil = await claudeJson(
    "Kamu membaca screenshot grafik 'Performance trends' dashboard live TikTok Shop (titik data per 5 menit). Baca setiap titik sedekat mungkin. Kalau sebuah garis tidak ada di gambar, isi null. Angka mata uang dalam rupiah penuh (402.75K = 402750).",
    [{ type: "image", source: { type: "base64", media_type: img.tipe, data: img.b64 } }, { type: "text", text: `Live dimulai jam ${l.jam_mulai || "(tidak diketahui)"}. Baca semua titik grafik.` }],
    {
      type: "object",
      properties: {
        garis: { type: "array", items: { type: "string" }, description: "nama metrik yang tampil di legenda grafik" },
        titik: { type: "array", items: { type: "object", properties: { jam: { type: "string", description: "HH:MM" }, nilai: { type: "object", additionalProperties: { type: ["number", "null"] }, description: "nama metrik → nilai" } }, required: ["jam", "nilai"] } },
        catatan: { type: "string" },
      },
      required: ["garis", "titik"],
    }, 6000);
  await db.from("lab_live").update({ grafik: hasil }).eq("id", l.id);
  return true;
}

function teksTranskrip(seg: any[]) {
  return seg.map((s) => `[${mmss(s.a)}] ${s.t}`).join("\n");
}

async function tahapTopik(l: any) {
  const seg = l.transkrip?.seg || [];
  if (!seg.length) { await db.from("lab_live").update({ topik: [] }).eq("id", l.id); return true; }
  const hasil = await claudeJson(
    "Kamu analis live streaming e-commerce (TikTok Shop, kategori beauty). Potong transkrip ucapan host menjadi topik berurutan yang tidak tumpang-tindih dan menutupi seluruh live. Satu topik = satu kegiatan utuh (misalnya membuka live, menjelaskan satu produk, menjawab komentar, promo/flash sale, closing, ngobrol bebas). Panjang wajar 1–8 menit. Tulis dalam bahasa Indonesia.",
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

function ringkasEkspor(rows: any[]) {
  if (!Array.isArray(rows) || !rows.length) return "(tidak ada file ekspor)";
  const kolom = ["Time", "Attributed GMV", "Attributed items sold", "Viewers", "Views", "Impressions", "Product Impressions", "Product Clicks", "LIVE CTR", "Tap-through rate", "Comments", "New followers", "Watch GPM", "Show GPM", "CTOR", "Payment Rate", "AOV"];
  let ada = kolom.filter((k) => k in rows[0]);
  if (ada.length < 4) ada = Object.keys(rows[0]).slice(0, 30); // nama kolom ekspor berbeda: kirim apa adanya
  return [ada.join(" | "), ...rows.slice(0, 60).map((r) => ada.map((k) => r[k]).join(" | "))].join("\n");
}

const SKEMA_MOMEN = {
  type: "object",
  properties: {
    jenis: { type: "string", enum: ["terbaik", "terburuk", "bahaya"] },
    mulai: { type: "number", description: "detik sejak live mulai" },
    selesai: { type: "number" },
    judul: { type: "string", description: "maksimal 8 kata" },
    bukti: { type: "string", description: "angka dari grafik/ekspor yang menunjukkan naik/turun; kosong kalau tidak ada" },
    kutipan: { type: "string", description: "ucapan host persis dari transkrip (maks 25 kata)" },
    alasan: { type: "string", description: "1-2 kalimat kenapa momen ini berhasil/gagal/berbahaya" },
  },
  required: ["jenis", "mulai", "selesai", "judul", "kutipan", "alasan"],
};

async function tahapAnalisis(l: any) {
  const { data: akun } = await db.from("lab_akun").select("nama").eq("id", l.akun_id).maybeSingle();
  const { data: host } = l.host_id ? await db.from("lab_host").select("nama").eq("id", l.host_id).maybeSingle() : { data: null };
  const topik = (l.topik || []).map((t: any) => `${mmss(t.mulai)}–${mmss(t.selesai)} [${t.jenis}] ${t.judul}${t.produk ? " · " + t.produk : ""}: ${t.ringkas}`).join("\n");
  const grafik = l.grafik?.titik?.length ? `Garis: ${(l.grafik.garis || []).join(", ")}\n` + l.grafik.titik.map((t: any) => `${t.jam}: ${Object.entries(t.nilai || {}).map(([k, v]) => `${k}=${v ?? "-"}`).join(", ")}`).join("\n") : "(tidak ada screenshot grafik)";
  const isi = `Akun: ${akun?.nama || "?"} · Host: ${host?.nama || "?"} · Tanggal ${l.tanggal} · Mulai jam ${l.jam_mulai || "?"} · Durasi ${mmss(l.durasi_detik || 0)}
Catatan orang di studio: ${l.catatan || "-"}

GRAFIK PER 5 MENIT (dibaca dari screenshot, perkiraan; jam = jam dinding):
${grafik}

EKSPOR PER 30 MENIT (angka resmi):
${ringkasEkspor(l.ekspor)}

TOPIK (waktu = sejak live mulai; jam dinding = jam mulai + waktu):
${topik}

TRANSKRIP LENGKAP:
${teksTranskrip(l.transkrip?.seg || []).slice(0, 150000)}`;
  const hasil = await claudeJson(
    `Kamu kepala tim live di MCN TikTok beauty Girlhood Den, terbiasa 复盘 (bedah ulang live) ala MCN China. Cocokkan ucapan dan topik host dengan naik-turun angka. Jangan mengarang angka: pakai hanya angka dari grafik/ekspor, dan sebut kalau angka hanya perkiraan dari grafik. Kalimat berbahaya = klaim berlebihan/menyesatkan (misalnya "pasti hilang dalam 3 hari"), tekanan beli palsu, janji yang tidak bisa dipenuhi, atau melanggar aturan TikTok. Patokan live beauty (sementara): rasio klik produk di bawah 18% berarti host lemah menjelaskan; klik ke bayar di bawah 5% berarti host lemah di kepercayaan/closing. Bahasa Indonesia sehari-hari, lugas.`,
    isi,
    {
      type: "object",
      properties: {
        ringkas: { type: "string", description: "maksimal 3 kalimat: bagaimana live ini secara keseluruhan" },
        angka: { type: "object", properties: { gmv: { type: ["number", "null"] }, terjual: { type: ["number", "null"] }, penonton: { type: ["number", "null"] }, klik_produk_persen: { type: ["number", "null"] }, klik_ke_bayar_persen: { type: ["number", "null"] } } },
        momen: { type: "array", items: SKEMA_MOMEN, description: "maksimal 3 terbaik, 3 terburuk, dan semua kalimat bahaya (maks 5)" },
        diagnosis: { type: "string", description: "masalah utama ada di host, produk, atau trafik, beserta buktinya" },
        saran: { type: "array", items: { type: "string" }, description: "maksimal 3 saran konkret untuk live berikutnya; satu saran = satu hal yang diubah" },
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
    try { const g = await unduhBase64(`${l.id}/lembar/${i}.jpg`); gambar.push({ type: "text", text: `Lembar ${i}: menit ${mmss(i * LEMBAR_DETIK)}–${mmss((i + 1) * LEMBAR_DETIK)} (12 foto, tiap 15 detik, kiri ke kanan lalu ke bawah)` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: g.b64 } }); } catch { /* lembar hilang: lewati */ }
  }
  if (!gambar.length) return true;
  const daftar = momen.map((m: any, k: number) => `${k}. [${m.jenis}] ${mmss(m.mulai)}–${mmss(m.selesai)} ${m.judul}`).join("\n");
  const hasil = await claudeJson(
    "Kamu melihat foto-foto layar live TikTok beauty. Untuk setiap momen, jelaskan apa yang terlihat: gerakan dan ekspresi host, produk yang dipegang, demo atau tidak, tulisan/stiker di layar, set dan pencahayaan. Hanya yang benar-benar terlihat; jangan menebak. Bahasa Indonesia, 1-2 kalimat per momen.",
    [...gambar, { type: "text", text: "Momen yang perlu dijelaskan:\n" + daftar }],
    { type: "object", properties: { visual: { type: "array", items: { type: "object", properties: { no: { type: "integer" }, terlihat: { type: "string" } }, required: ["no", "terlihat"] } } }, required: ["visual"] }, 3000);
  for (const v of hasil.visual || []) if (momen[v.no]) momen[v.no].visual = v.terlihat;
  await db.from("lab_live").update({ laporan: lap }).eq("id", l.id);
  return true;
}

async function selesaikan(l: any) {
  await db.from("lab_live").update({ status: "selesai", tahap: null, selesai_at: new Date().toISOString(), galat: null }).eq("id", l.id);
  const { data: akun } = await db.from("lab_akun").select("nama").eq("id", l.akun_id).maybeSingle();
  const { data: host } = l.host_id ? await db.from("lab_host").select("nama").eq("id", l.host_id).maybeSingle() : { data: null };
  const lap = l.laporan || {};
  const ikon: Record<string, string> = { terbaik: "🟢", terburuk: "🔴", bahaya: "⚠️" };
  if (String(l.catatan || "").startsWith("[uji]")) return; // uji sistem: tanpa pesan Lark
  await kirimLark(`Lab Live · ${akun?.nama || "?"} · ${host?.nama || "host ?"} · ${l.tanggal}\n\n${lap.ringkas || ""}\n\n`
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
  try {
    const fungsi: Record<string, (l: any) => Promise<boolean>> = { transkrip: tahapTranskrip, grafik: tahapGrafik, topik: tahapTopik, analisis: tahapAnalisis, visual: tahapVisual };
    const tuntas = await fungsi[tahap](l);
    const berikut = tuntas ? tahapBerikut(tahap) : tahap;
    if (!berikut) {
      const { data: segar } = await db.from("lab_live").select("*").eq("id", l.id).single();
      await selesaikan(segar);
      return true;
    }
    await db.from("lab_live").update({ status: "antre", tahap: berikut, coba: 0, galat: null }).eq("id", l.id);
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
        db.from("lab_live").select("id, akun_id, host_id, tanggal, jam_mulai, durasi_detik, status, tahap, galat, dibuat_at, selesai_at, laporan->ringkas, laporan->angka").order("tanggal", { ascending: false }).order("dibuat_at", { ascending: false }).limit(60),
      ]);
      const out: any = { pimpinan: staff.pimpinan, akun, host, live };
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
      if (tabel === "lab_akun") isi.laboratorium = !!b.laboratorium; else isi.akun_id = b.akun_id || null;
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
      if (!nAudio) return balas({ galat: "TANPA_SUARA" }, 400);
      const ekspor = Array.isArray(b.ekspor) ? b.ekspor.slice(0, 500) : null;
      const { data: l, error } = await db.from("lab_live").insert({
        akun_id: akun.id, host_id: b.host_id || null, tanggal: String(b.tanggal || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
        jam_mulai: String(b.jam_mulai || "").slice(0, 5) || null, durasi_detik: Math.round(Number(b.durasi_detik) || 0),
        catatan: String(b.catatan || "").slice(0, 3000) || null, ekspor, potongan_audio: nAudio, lembar: nLembar,
        ada_grafik: !!b.ada_grafik, dibuat_oleh: staff.id,
      }).select("id").single();
      if (error) throw error;
      const jalur = [
        ...Array.from({ length: nAudio }, (_, i) => `${l.id}/audio/${i}.mp3`),
        ...Array.from({ length: nLembar }, (_, i) => `${l.id}/lembar/${i}.jpg`),
        ...(b.ada_grafik ? [`${l.id}/grafik`] : []),
      ];
      const url: Record<string, string> = {};
      for (const p of jalur) {
        const { data: s, error: e2 } = await db.storage.from(BUCKET).createSignedUploadUrl(p);
        if (e2 || !s) throw e2 || new Error("signed url");
        url[p.slice(l.id.length + 1)] = s.token;
      }
      return balas({ id: l.id, token: url });
    }

    if (b.aksi === "siap") {
      const { data: l } = await db.from("lab_live").select("id, status, potongan_audio, lembar, ada_grafik").eq("id", b.id).single();
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
      const jalur = Array.from({ length: l.lembar }, (_, i) => `${l.id}/lembar/${i}.jpg`);
      const { data: s } = jalur.length ? await db.storage.from(BUCKET).createSignedUrls(jalur, 6 * 3600) : { data: [] };
      const { data: g } = l.ada_grafik ? await db.storage.from(BUCKET).createSignedUrl(`${l.id}/grafik`, 6 * 3600) : { data: null };
      return balas({ ...l, url_lembar: (s || []).map((x: any) => x.signedUrl || null), url_grafik: g?.signedUrl || null, lembar_detik: LEMBAR_DETIK });
    }

    if (b.aksi === "ulang") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      await db.from("lab_live").update({ status: "antre", coba: 0, galat: null }).eq("id", b.id).eq("status", "gagal");
      sambungLagi();
      return balas({ ok: true });
    }

    if (b.aksi === "hapus") {
      if (!staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const { data: l } = await db.from("lab_live").select("id, potongan_audio, lembar").eq("id", b.id).single();
      if (!l) return balas({ ok: true });
      const jalur = [
        ...Array.from({ length: l.potongan_audio }, (_, i) => `${l.id}/audio/${i}.mp3`),
        ...Array.from({ length: l.lembar }, (_, i) => `${l.id}/lembar/${i}.jpg`),
        `${l.id}/grafik`,
      ];
      await db.storage.from(BUCKET).remove(jalur);
      await db.from("lab_live").delete().eq("id", l.id);
      return balas({ ok: true });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    console.error("lab-live", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
