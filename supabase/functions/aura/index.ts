// Aura: asisten internal Girlhood Den (dulu Jarvis; menggantikan Gantara).
// Aksi: riwayat, sapa, dengar (suara -> teks lewat Whisper di Groq, gratis), chat. Login wajib (staff internal aktif). Kuota bersama Kantor AI (50/hari),
// tim hanya sampai 17.00 WIB (CEO/COO bebas). Data dibaca lewat peran baca-saja dalam transaksi READ ONLY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.4";
import { SKEMA } from "./skema.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1, idle_timeout: 20 });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-5-5"; // Aura = manajer & teman diskusi: butuh nalar lebih dalam dari karyawan AI lain (haiku)
const MAKS_PUTARAN = 6;
const BATAS_GLOBAL = 400;
const AGENT = "aura";
const JAM_TUTUP = 17;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
// kata-kata kita, supaya pendengaran tidak salah tangkap (misal "Girlhood Den" jadi "golden")
const KOSAKATA = "Aura, Girlhood Den, Saturnine Media, skp, Gabriella, KIME, Hanasui, SKIN1004, OMG, Oh My Glam, Glad2Glow, Skintific, GMV, TAP, FastMoss, KOL, AE, GDLC, harta karun, creator, affiliate, sampel, SOW, live, VT, payday, Super Brand Day, product palette.";
// kalimat yang sering "dikarang" Whisper saat hening
const HALUSINASI = /^(terima kasih( telah menonton| sudah menonton)?|thank you( for watching)?|subtitle[s]? by.*|\.+)$/i;
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "origin",
});

const PERSONA = `Kamu Aura, asisten internal Girlhood Den (MCN TikTok Affiliate/TAP kategori beauty, partner TikTok "Saturnine Media"). Dulu namamu Jarvis; kamu juga menggantikan Gantara (manajer AI). Kamu bicara dengan tim internal: skp (CEO), Gabriella Edny (COO), AE, dan KOL Affiliate Specialist.

CARA BERPIKIR
- Dasar semua saranmu adalah BIBLE di bawah: cara kerja, prinsip, dan framework skp. Kalau ditanya "harus gimana", jawab dengan framework Bible, sebut bagian mana yang dipakai.
- Kalau Bible tidak membahas hal yang ditanya, katakan itu belum ada di Bible, lalu beri saran wajar yang jelas ditandai sebagai saranmu sendiri.
- Angka (GMV, order, creator, sampel, poin) HANYA dari alat query_data. Jangan mengarang angka. Periode bawaan = bulan berjalan WIB; selalu sebut periodenya.
- Kamu hanya bisa membaca data. Kalau diminta mengubah, menghapus, atau mengirim sesuatu, katakan tidak bisa dan arahkan ke website atau ke skp.
- Keputusan freeze creator, budget, komisi ekstra, dan keputusan bisnis penting bukan keputusanmu: beri rekomendasi + alasan, lalu sebut siapa yang memutuskan (bisnis: skp, operasional/HR/finance: Gabriella).
- Jangan bahas gaji, insentif pribadi, atau angka komisi internal tim. Jangan membagikan data pribadi (HP, email, alamat, kode login).
- Jangan membicarakan kinerja atau kesalahan anggota tim lain kepada orang yang sedang bicara denganmu.
- Ajak orang membawa opsi, bukan hanya bertanya "solusinya gimana": kalau tim bertanya tanpa opsi, beri 2–3 opsi dengan risikonya lalu minta mereka memilih.

CARA BERNALAR (seperti skp: selangkah di depan, mulai dari data)
- Pahami dulu maksud sebenarnya di balik pertanyaan, bukan cuma kata-katanya. Kalau ada dua kemungkinan maksud, pilih yang paling masuk akal dari konteks obrolan, atau tanya balik singkat.
- Soal kinerja (GMV, brand, creator, sampel): ambil datanya, bandingkan dengan periode sebelumnya yang sama panjang, cari penyebab yang bisa dikontrol (lihat Bible: diagnosis gap GMV), lalu sampaikan kesimpulan, bukan sekadar angka.
- Beri pendapatmu sendiri dengan jujur: apa yang menurutmu terjadi, apa yang sebaiknya dilakukan duluan, dan kenapa. Sebut asumsi atau risikonya kalau ada.
- Hubungkan dengan prinsip Bible yang relevan supaya tim belajar cara berpikirnya, bukan cuma jawabannya.
- Kalau melihat hal penting yang tidak ditanya tapi berdampak (misal brand prioritas turun tajam), sebutkan singkat di akhir.

PEKA
- Ingat isi obrolan sebelumnya dan lanjutkan dari sana; jangan mengulang pertanyaan yang sudah dijawab.
- Perhatikan nada: kalau orangnya terdengar ragu, buntu, atau kesal, tanggapi dulu perasaannya satu kalimat, baru bantu.
- Jawaban pendek seperti "boleh", "oke", "lanjut" berarti setuju dengan tawaranmu sebelumnya: langsung kerjakan.

GAYA
- Bahasa Indonesia sehari-hari, hangat tapi lugas, langsung ke poin. Sapa dengan nama.
- Teks biasa tanpa markdown (jangan pakai ** atau tabel |). Boleh nomor dan baris baru. Panjang secukupnya sesuai kebutuhan; kalau panjang, pecah jadi paragraf pendek.
- Kalau pertanyaan tidak jelas, tanya balik satu kalimat.

SESI 16.30–17.00 (Senin–Jumat, untuk AE/KOL/anak baru, bukan skp dan Gabriella)
- Pandu refleksi satu pertanyaan per giliran: apa yang dikerjakan hari ini, apa yang berhasil dan gagal, kenapa, solusinya besok. Untuk KOL tanyakan juga berapa creator dikontak dan berapa yang menolak serta alasannya.
- Kalau jawabannya berulang/template tanpa progres, tegur sopan dan tanya apakah ada masalah pribadi atau pekerjaan yang bisa dibantu.`;

const ALAT_DATA = {
  name: "query_data",
  description: "Jalankan SATU query SQL SELECT (PostgreSQL) baca-saja ke database Girlhood Den. Hasil maksimal 200 baris (JSON). Pakai agregasi (sum/count/group by) supaya hasilnya ringkas.",
  input_schema: { type: "object", properties: { sql: { type: "string", description: "Query SELECT" } }, required: ["sql"] },
};

async function ambilData(q: string): Promise<string> {
  try {
    const bersih = String(q || "").trim().replace(/;+\s*$/, "");
    if (!/^(select|with)\s/i.test(bersih) || bersih.includes(";")) throw new Error("hanya satu perintah SELECT yang boleh");
    const rows = await sql.begin("read only", async (tx) => {
      await tx`set local role kantor_bot_reader`;
      await tx`set local statement_timeout = '8s'`;
      return await tx.unsafe("select * from (" + bersih + ") as hasil limit 200");
    });
    const teks = JSON.stringify(rows);
    return teks.length > 12000 ? teks.slice(0, 12000) + "…(terpotong)" : teks;
  } catch (e) {
    return "GALAT: " + String((e as Error)?.message || e).slice(0, 300);
  }
}

function sekarangWib() {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { jam: Number(p.hour), menit: Number(p.minute), hari: p.weekday, tanggal: `${p.year}-${p.month}-${p.day}` };
}
function awalHariIso() {
  const { tanggal } = sekarangWib();
  return new Date(tanggal + "T00:00:00+07:00").toISOString();
}

async function staffDari(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: s } = await db.from("internal_staff").select("id, nama").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
  if (!s) return null;
  const { data: cfg } = await db.from("app_config").select("key, value").in("key", ["kantor_ceo", "kantor_coo"]);
  const jab = (cfg || []).find((c) => c.value === s.id)?.key;
  const { data: p } = await db.from("aura_staff").select("peran_kerja").eq("staff_id", s.id).maybeSingle();
  return { id: s.id as string, nama: s.nama as string, pimpinan: !!jab, peran: p?.peran_kerja || (jab === "kantor_coo" ? "COO" : jab === "kantor_ceo" ? "CEO" : "tim internal") };
}

function statusJam(pimpinan: boolean) {
  const w = sekarangWib();
  const tutup = !pimpinan && (w.jam >= JAM_TUTUP || w.jam < 5);
  const sesiRefleksi = !pimpinan && !["Sat", "Sun"].includes(w.hari) && (w.jam === 16 && w.menit >= 30);
  return { tutup, sesiRefleksi, jam: `${String(w.jam).padStart(2, "0")}.${String(w.menit).padStart(2, "0")}`, hari: w.hari };
}

async function kuota(staffId: string) {
  const { data } = await db.rpc("kantor_kuota", { p_key: "staff:" + staffId });
  return data as { pakai: number; batas: number; menunggu: boolean };
}

async function bible(): Promise<string> {
  const { data } = await db.from("aura_bible").select("judul, isi").eq("aktif", true).order("urutan");
  return (data || []).map((b) => `## ${b.judul}\n${b.isi}`).join("\n\n");
}

async function tanya(pesanBaru: string, riwayat: any[], dinamis: string, maks = 1500): Promise<{ teks: string; masuk: number; keluar: number }> {
  const sistem = [
    { type: "text", text: PERSONA },
    { type: "text", text: "BIBLE GIRLHOOD DEN (dari skp)\n\n" + (await bible()) },
    { type: "text", text: SKEMA, cache_control: { type: "ephemeral" } },
    { type: "text", text: dinamis },
  ];
  const pesan: any[] = [...riwayat, { role: "user", content: pesanBaru }];
  let masuk = 0, keluar = 0, diringkas = false;
  for (let i = 0; i < MAKS_PUTARAN; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maks, system: sistem, tools: [ALAT_DATA], messages: pesan }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Claude API " + r.status + ": " + String(j?.error?.message || "").slice(0, 200));
    masuk += (j.usage?.input_tokens || 0) + (j.usage?.cache_read_input_tokens || 0) + (j.usage?.cache_creation_input_tokens || 0);
    keluar += j.usage?.output_tokens || 0;
    // Kepanjangan sampai terpotong: pakai teks yang sudah ada, atau minta ulang ringkas sekali.
    if (j.stop_reason === "max_tokens") {
      const sebagian = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      if (sebagian && !(j.content || []).some((b: any) => b.type === "tool_use")) return { teks: sebagian.replace(/[^.!?]*$/, "").trim() || sebagian, masuk, keluar };
      if (!diringkas) {
        diringkas = true;
        pesan.push({ role: "assistant", content: sebagian ? [{ type: "text", text: sebagian }] : [{ type: "text", text: "(terpotong)" }] });
        pesan.push({ role: "user", content: "Jawabanmu terpotong. Jawab ulang lebih ringkas, pakai data yang sudah ada." });
        continue;
      }
    }
    pesan.push({ role: "assistant", content: j.content });
    const panggilan = (j.content || []).filter((b: any) => b.type === "tool_use");
    if (j.stop_reason !== "tool_use" || !panggilan.length) {
      const teks = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      if (!teks) throw new Error("jawaban kosong (" + j.stop_reason + ")");
      return { teks, masuk, keluar };
    }
    const hasil = [];
    for (const p of panggilan) hasil.push({ type: "tool_result", tool_use_id: p.id, content: p.name === "query_data" ? await ambilData(p.input?.sql) : "alat tidak dikenal" });
    pesan.push({ role: "user", content: hasil });
  }
  return { teks: "Pertanyaannya butuh terlalu banyak langkah. Coba dipersempit, misalnya sebut brand dan periodenya.", masuk, keluar };
}

Deno.serve(async (req) => {
  const o = req.headers.get("origin") || "";
  const h = { ...cors(o), "content-type": "application/json" };
  const balas = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o) });

  const staff = await staffDari(req);
  if (!staff) return balas({ galat: "BUKAN_INTERNAL" }, 401);
  let b: any = {};
  try { b = await req.json(); } catch { return balas({ galat: "FORMAT" }, 400); }
  const jam = statusJam(staff.pimpinan);

  try {
    if (b.aksi === "riwayat") {
      const { data } = await db.from("kantor_chat").select("id, peran, isi, created_at").eq("staff_id", staff.id).eq("agent", AGENT)
        .order("id", { ascending: false }).limit(30);
      return balas({ pesan: (data || []).reverse(), kuota: await kuota(staff.id), jam, peran: staff.peran, dengarServer: !!GROQ_KEY });
    }

    // Aura membuka percakapan: sekali sehari dibuat dari data (disimpan), sesudahnya sapaan singkat tanpa AI.
    if (b.aksi === "sapa") {
      if (jam.tutup) return balas({ teks: `Hai ${staff.nama}. Aku sudah istirahat sejak jam 17.00. Sampai besok pagi ya.`, tutup: true });
      const { count: sudah } = await db.from("kantor_chat").select("id", { count: "exact", head: true })
        .eq("staff_id", staff.id).eq("agent", AGENT).gte("created_at", awalHariIso());
      if ((sudah || 0) > 0) return balas({ teks: `Hai lagi, ${staff.nama}. Mau lanjut bahas apa?`, baru: false });
      const { data: kemarin } = await db.rpc("kantor_sapa_data");
      const w = sekarangWib();
      const dinamis = `Yang sedang bicara denganmu: ${staff.nama} (${staff.peran}). Sekarang ${w.hari} ${w.tanggal}, jam ${jam.jam} WIB.\n`
        + `Angka kemarin (sudah dihitung): ${JSON.stringify(kemarin)}\n`
        + "TUGAS: kamu yang MEMBUKA percakapan hari ini, jawabanmu akan DIBACAKAN. Sapa dia sesuai waktu (pagi/siang/sore), sampaikan hal paling penting dari angka kemarin dengan bahasa lisan beserta artinya (bukan cuma angka), lalu tutup dengan SATU pertanyaan untuknya (misal rencana atau fokus hari ini). Natural seperti ngobrol, tanpa daftar dan simbol.";
      const hsl = await tanya("(Aura membuka percakapan)", [], dinamis, 800);
      await db.from("kantor_chat").insert({ staff_id: staff.id, agent: AGENT, peran: "assistant", isi: hsl.teks.slice(0, 4000), input_tokens: hsl.masuk, output_tokens: hsl.keluar });
      return balas({ teks: hsl.teks, baru: true });
    }

    if (b.aksi === "dengar") {
      if (!GROQ_KEY) return balas({ galat: "TANPA_KUNCI" }, 501);
      const audio = String(b.audio || "");
      if (!audio || audio.length > 4_000_000) return balas({ galat: "AUDIO" }, 400);
      const tipe = String(b.tipe || "audio/webm").split(";")[0];
      const ext = tipe.includes("mp4") ? "mp4" : tipe.includes("ogg") ? "ogg" : "webm";
      const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
      const f = new FormData();
      f.append("file", new Blob([bytes], { type: tipe }), "ucapan." + ext);
      f.append("model", "whisper-large-v3-turbo");
      f.append("language", "id");
      f.append("temperature", "0");
      f.append("response_format", "json");
      f.append("prompt", KOSAKATA);
      const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + GROQ_KEY }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.error("groq", r.status, JSON.stringify(j).slice(0, 200)); return balas({ galat: r.status === 429 ? "PENUH" : "DENGAR" }, 502); }
      const teks = String(j.text || "").trim();
      return balas({ teks: HALUSINASI.test(teks) || teks === KOSAKATA ? "" : teks });
    }

    if (b.aksi === "chat") {
      const pesan = String(b.pesan || "").trim().slice(0, 2000);
      if (!pesan) return balas({ galat: "KOSONG" }, 400);
      if (jam.tutup) return balas({ galat: "TUTUP", jam }, 403);
      const kq = await kuota(staff.id);
      if (kq.pakai >= kq.batas) return balas({ galat: "KUOTA", kuota: kq }, 429);
      const { count } = await db.from("kantor_chat").select("id", { count: "exact", head: true }).eq("peran", "user").gte("created_at", awalHariIso());
      if ((count || 0) > BATAS_GLOBAL) return balas({ galat: "PENUH" }, 429);

      const { data: lalu } = await db.from("kantor_chat").select("peran, isi").eq("staff_id", staff.id).eq("agent", AGENT)
        .gte("created_at", new Date(Date.now() - 3 * 86400 * 1000).toISOString()).order("id", { ascending: false }).limit(12);
      // riwayat harus selang-seling user/assistant dan diawali user
      const riwayat: { role: string; content: string }[] = [];
      for (const r of (lalu || []).reverse()) {
        const role = r.peran === "assistant" ? "assistant" : "user";
        if (!riwayat.length && role !== "user") riwayat.push({ role: "user", content: "(Aura membuka percakapan)" });
        if (riwayat.length && riwayat[riwayat.length - 1].role === role) riwayat[riwayat.length - 1].content += "\n" + r.isi;
        else riwayat.push({ role, content: r.isi });
      }
      if (riwayat.length && riwayat[riwayat.length - 1].role === "user") riwayat.pop();

      const { data: pUser, error: e1 } = await db.from("kantor_chat").insert({ staff_id: staff.id, agent: AGENT, peran: "user", isi: pesan })
        .select("id, peran, isi, created_at").single();
      if (e1) throw new Error("simpan pesan gagal: " + e1.message);

      const w = sekarangWib();
      const dinamis = `Yang sedang bicara denganmu: ${staff.nama} (${staff.peran}). Sekarang ${w.hari} ${w.tanggal}, jam ${jam.jam} WIB.`
        + (jam.sesiRefleksi ? "\nSEKARANG JAM SESI 16.30: pandu refleksi harian sesuai aturan sesi." : "")
        + (b.suara ? "\nPesan ini diucapkan lewat suara dan jawabanmu akan DIBACAKAN: bicara natural seperti ngobrol dengan rekan kerja, panjang secukupnya sesuai kebutuhan pertanyaan (tidak perlu dipendek-pendekkan). Karena dibacakan, JANGAN pakai daftar bernomor, poin-poin, atau simbol; kalau ada beberapa poin, sampaikan sebagai kalimat mengalir (pertama..., lalu..., terakhir...). Angka rupiah ditulis seperti diucapkan (misal 2,5 miliar). Teks pesannya hasil pengenal suara dan bisa salah dengar: \"bagi\" bisa berarti \"pagi\"; \"Google\", \"Golden\", \"Gold in\" hampir selalu berarti \"Girlhood Den\"; \"Kimi\" berarti KIME. Tafsirkan maksud yang paling masuk akal dan JANGAN mempersoalkan atau menyebut salah dengarnya. Pakai \"aku\", bukan \"saya\". Kalau cocok, akhiri dengan satu pertanyaan supaya obrolan berlanjut." : "");
      const hsl = await tanya(pesan, riwayat, dinamis, 2000);
      const { data: pAi, error: e2 } = await db.from("kantor_chat").insert({ staff_id: staff.id, agent: AGENT, peran: "assistant", isi: hsl.teks.slice(0, 12000), input_tokens: hsl.masuk, output_tokens: hsl.keluar })
        .select("id, peran, isi, created_at").single();
      if (e2) throw new Error("simpan jawaban gagal: " + e2.message);
      return balas({ user: pUser, jawab: pAi, kuota: await kuota(staff.id) });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    const g = String((e as Error)?.message || e).slice(0, 300);
    console.error("aura", g);
    return balas({ galat: /credit|balance|billing/i.test(g) ? "SALDO" : "GAGAL" }, 500);
  }
});
