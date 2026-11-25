// Studio IP: kartu karakter host (dikembangkan bersama Aura), kartu produk, penulis naskah bergaya karakter,
// cek kalimat berbahaya, dan versi naskah baru dari komentar penonton. Tanpa host AI: semua untuk host manusia.
// Prinsip: karakter diambil dari orang asli (bukti dari live), Aura mengusulkan, pimpinan mengunci.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-5-5";
const ASAL = [/^https:\/\/(www\.)?girlhoodden\.com$/, /^http:\/\/localhost:8777$/];
const cors = (o: string) => ({
  "access-control-allow-origin": ASAL.some((r) => r.test(o)) ? o : "https://girlhoodden.com",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "origin",
});

// Bidang kartu karakter (urutan = urutan tampil). Dasar: Kartu Karakter + Panduan Wawancara + 8 cerita (riset "Membangun IP dari 0").
const BIDANG: Record<string, string> = {
  label: "Label persona 1–3 kata",
  kontras: "Kontras (sifat yang bertolak belakang, sumber daya tarik)",
  cerita: "8 cerita: awal, perjuangan, titik balik, cara/tips, bangkit, membantu, refleksi, visi",
  kalimat_andalan: "Kalimat andalan (dari kebiasaan asli)",
  nama_panggung: "Nama panggung",
  sapaan: "Sapaan untuk penonton/komunitas",
  gaya_bicara: "Gaya bicara (tempo, kata khas, cara menjelaskan)",
  kategori: "Kategori produk yang cocok",
  target: "Target penonton",
  hindari: "Kata/sikap yang dihindari",
  risiko: "Risiko yang perlu dijaga",
};
// Kata/klaim berisiko untuk skincare (TikTok Shop & BPOM): dicek kode sebelum AI
const KATA_BAHAYA = ["pasti", "dijamin", "jaminan", "100%", "seratus persen", "permanen", "selamanya", "menyembuhkan", "sembuh", "mengobati", "obat", "paling ampuh", "paling bagus", "nomor 1", "no 1", "terbaik di dunia", "tanpa efek samping", "aman untuk semua", "langsung putih", "instan putih", "dalam 3 hari", "dalam semalam", "hilang total", "stok terakhir", "harga naik besok", "cuma hari ini"];

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

async function claudeJson(system: string, content: any, schema: any, max_tokens = 6000) {
  let galat: unknown;
  for (let coba = 0; coba < 2; coba++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens, system: system + "\n\nSimpan hasilmu HANYA dengan memanggil alat simpan.", tools: [{ name: "simpan", description: "Simpan hasil.", input_schema: schema }], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
      });
      const teks = await r.text();
      if (!r.ok) throw new Error("Claude " + r.status + " " + teks.slice(0, 200));
      const blok = (JSON.parse(teks).content || []).find((b: any) => b.type === "tool_use");
      if (!blok?.input) throw new Error("Claude tanpa hasil");
      return blok.input;
    } catch (e) { galat = e; }
  }
  throw galat;
}

const normal = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const KATA_UMUM = new Set("yang dan di ke dari ini itu aku kamu kak ya ini nya juga ada udah sudah buat untuk dengan jadi kalau kalo aja sih dong deh lagi bisa mau nggak gak enggak tapi atau karena biar terus trus banget pada akan oke ok kita kalian guys".split(" "));

// Ungkapan 2–4 kata yang paling sering diucapkan host di semua live yang dibedah (calon kalimat andalan dari kebiasaan asli)
function ungkapanBerulang(semuaSeg: string[]) {
  const hitung = new Map<string, number>();
  for (const t of semuaSeg) {
    const k = normal(t).split(" ").filter(Boolean);
    const dilihat = new Set<string>();
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= k.length; i++) {
      const g = k.slice(i, i + n);
      if (g.every((w) => KATA_UMUM.has(w)) || g.filter((w) => !KATA_UMUM.has(w)).length < 1) continue;
      const f = g.join(" ");
      if (dilihat.has(f)) continue;
      dilihat.add(f);
      hitung.set(f, (hitung.get(f) || 0) + 1);
    }
  }
  const urut = [...hitung.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const hasil: { teks: string; kali: number }[] = [];
  for (const [f, n] of urut) { if (hasil.some((h) => h.teks.includes(f))) continue; hasil.push({ teks: f, kali: n }); if (hasil.length >= 15) break; }
  return hasil;
}

async function pertanyaanPenonton(akunId: string | null, sejak?: string) {
  if (!akunId) return [];
  let q = db.from("lab_pantau").select("id").eq("akun_id", akunId).order("mulai", { ascending: false }).limit(30);
  const { data: sesi } = await q;
  if (!sesi?.length) return [];
  let t = db.from("lab_pantau_titik").select("komentar, dibuat_at").in("pantau_id", sesi.map((x: any) => x.id)).limit(3000);
  if (sejak) t = t.gt("dibuat_at", sejak);
  const { data: titik } = await t;
  const hitung = new Map<string, { teks: string; n: number }>();
  for (const x of titik || []) for (const p of x.komentar?.pertanyaan || []) { const k = normal(p); if (!k) continue; const v = hitung.get(k) || { teks: p, n: 0 }; v.n++; hitung.set(k, v); }
  return [...hitung.values()].sort((a, b) => b.n - a.n).slice(0, 20);
}

async function buktiLive(k: any) {
  if (!k.host_id) return { ungkapan: [], terbaik: [], bahaya: [], ulasan: [], jumlah_live: 0, pertanyaan: await pertanyaanPenonton(k.akun_id) };
  const { data: live } = await db.from("lab_live").select("tanggal, transkrip, laporan, ulasan").eq("host_id", k.host_id).eq("status", "selesai").order("tanggal", { ascending: false }).limit(20);
  const seg = (live || []).flatMap((l: any) => (l.transkrip?.seg || []).filter((s: any) => !s.r).map((s: any) => s.t));
  const terbaik: string[] = [], bahaya: string[] = [], ulasan: string[] = [];
  for (const l of live || []) {
    (l.laporan?.momen || []).forEach((m: any, i: number) => {
      const u = l.ulasan?.[i];
      if (m.jenis === "terbaik" && u?.nilai !== "kurang") terbaik.push(`${l.tanggal}: "${m.kutipan}" — ${m.alasan}`);
      if (m.jenis === "bahaya") bahaya.push(`"${m.kutipan}"`);
      if (u?.nilai === "kurang" && u.catatan) ulasan.push(`${m.judul}: ${u.catatan}`);
    });
  }
  return { ungkapan: ungkapanBerulang(seg), terbaik: terbaik.slice(0, 12), bahaya: bahaya.slice(0, 10), ulasan: ulasan.slice(0, 10), jumlah_live: (live || []).length, pertanyaan: await pertanyaanPenonton(k.akun_id) };
}

const teksKartu = (kartu: any) => Object.entries(BIDANG).map(([b, nama]) => `- ${nama} [${kartu?.[b]?.status || "kosong"}]: ${kartu?.[b]?.isi || "(kosong)"}`).join("\n");
const teksBukti = (b: any) => `Jumlah live yang sudah dibedah: ${b.jumlah_live}
Ungkapan yang sering diucapkan host (dari transkrip, calon kalimat andalan): ${b.ungkapan.map((u: any) => `"${u.teks}" (${u.kali}×)`).join(", ") || "-"}
Momen terbaik (dari Lab Live): ${b.terbaik.join(" | ") || "-"}
Kalimat berbahaya yang pernah diucapkan: ${b.bahaya.join(" | ") || "-"}
Koreksi pimpinan atas bedah live: ${b.ulasan.join(" | ") || "-"}
Pertanyaan penonton terbanyak (Pantau Live): ${b.pertanyaan.map((p: any) => `${p.teks} (${p.n}×)`).join(", ") || "-"}`;

function cekKata(teks: string) {
  const t = " " + normal(teks).replace(/seratus persen/g, "seratus persen") + " ";
  const mentah = String(teks || "").toLowerCase();
  return KATA_BAHAYA.filter((k) => k.includes("%") ? mentah.includes(k) : t.includes(" " + normal(k) + " "));
}

const SKEMA_NASKAH = {
  type: "object",
  properties: {
    pembuka: { type: "object", properties: { poin: { type: "array", items: { type: "string" } }, menit: { type: "number" } }, required: ["poin"] },
    produk: {
      type: "array",
      items: {
        type: "object",
        properties: {
          produk_id: { type: "string" },
          nama: { type: "string" },
          menit: { type: "number", description: "perkiraan durasi menjelaskan produk ini" },
          pembuka: { type: "string", description: "kalimat pancingan 3 detik pertama, gaya karakter" },
          masalah: { type: "string", description: "masalah penonton yang diangkat" },
          demo: { type: "array", items: { type: "string" }, description: "langkah demo/peragaan yang ditunjukkan ke kamera" },
          manfaat: { type: "array", items: { type: "string" }, description: "maks 3 manfaat, bahasa sehari-hari, tanpa klaim mutlak" },
          bukti: { type: "array", items: { type: "string" }, description: "bukti yang benar-benar ada di kartu produk" },
          harga: { type: "string", description: "cara membuka harga: harga normal → harga live → promo/gimmick" },
          ajakan: { type: "string", description: "ajakan beli: nomor keranjang, batas waktu yang benar" },
          interaksi: { type: "array", items: { type: "string" }, description: "2 pancingan komentar" },
          jawaban: { type: "array", items: { type: "object", properties: { tanya: { type: "string" }, jawab: { type: "string" } }, required: ["tanya", "jawab"] }, description: "jawaban untuk pertanyaan penonton yang relevan" },
        },
        required: ["produk_id", "nama", "pembuka", "manfaat", "harga", "ajakan"],
      },
    },
    penutup: { type: "object", properties: { poin: { type: "array", items: { type: "string" } } }, required: ["poin"] },
    catatan_host: { type: "array", items: { type: "string" }, description: "maks 3 pengingat gaya untuk host (dari kartu karakter)" },
  },
  required: ["pembuka", "produk", "penutup"],
};

async function tulisNaskah(k: any, produk: any[], durasi: number, catatan: string, bukti: any, sebelumnya?: any) {
  const daftarProduk = produk.map((p) => `[${p.id}] ${JSON.stringify(p.data)}`).join("\n");
  const isi = `KARTU KARAKTER "${k.nama}":\n${teksKartu(k.kartu)}\n\nBUKTI DARI LIVE:\n${teksBukti(bukti)}\n\nPRODUK SESI INI (urut sesuai daftar, pakai produk_id persis):\n${daftarProduk}\n\nDurasi sesi: ${durasi} menit. Catatan tim: ${catatan || "-"}`
    + (sebelumnya ? `\n\nNASKAH VERSI SEBELUMNYA (perbaiki, jangan buang yang sudah bagus):\n${JSON.stringify(sebelumnya).slice(0, 20000)}\n\nTUGAS VERSI BARU: tambahkan jawaban untuk pertanyaan penonton terbaru di atas dan pakai kalimat yang terbukti berhasil.` : "");
  return await claudeJson(
    `Kamu "penulis cerita di ruang live" (导播) di MCN beauty Girlhood Den. Tulis POIN teleprompter, bukan naskah kata per kata: host bicara dengan kata-katanya sendiri.
Aturan:
- Pakai gaya karakter di kartu: label, kontras, sapaan, gaya bicara, kalimat andalan yang sudah ada. Bidang berstatus "kunci" wajib diikuti; "uji" boleh dicoba; "draf"/kosong jangan dijadikan pegangan.
- Pola per produk ala MCN China: pancingan 3 detik → masalah penonton → demo di kamera → manfaat (maks 3) → bukti → buka harga (normal → live → promo) → ajakan beli → pancingan komentar.
- Fakta produk (harga, bahan, bukti, promo) HANYA dari kartu produk. Kalau tidak ada, jangan dikarang.
- Dilarang klaim mutlak/medis/tekanan palsu: pasti, dijamin, 100%, permanen, menyembuhkan, paling ampuh, nomor 1, tanpa efek samping, langsung putih, hasil dalam X hari, stok terakhir/harga naik besok (kecuali benar dan tertulis di kartu produk). Pakai bahasa aman: "membantu", "banyak yang merasa", "hasil tiap orang bisa beda".
- Jawab pertanyaan penonton terbanyak di produk yang relevan.
- Bahasa Indonesia sehari-hari, kalimat pendek, mudah dibaca sekilas di layar.`,
    isi, SKEMA_NASKAH, 8000);
}

async function cekNaskah(isi: any) {
  const temuan: { lokasi: string; kata: string[]; teks: string }[] = [];
  const periksa = (lokasi: string, teks: any) => { const t = Array.isArray(teks) ? teks.join(" ") : typeof teks === "object" && teks ? JSON.stringify(teks) : String(teks || ""); const k = cekKata(t); if (k.length) temuan.push({ lokasi, kata: k, teks: t.slice(0, 200) }); };
  (isi.pembuka?.poin || []).forEach((p: string, i: number) => periksa(`Pembuka ${i + 1}`, p));
  (isi.produk || []).forEach((p: any) => { for (const b of ["pembuka", "masalah", "demo", "manfaat", "bukti", "harga", "ajakan", "interaksi"]) if (p[b]) periksa(`${p.nama} · ${b}`, p[b]); (p.jawaban || []).forEach((j: any) => periksa(`${p.nama} · jawaban`, j.jawab)); });
  (isi.penutup?.poin || []).forEach((p: string, i: number) => periksa(`Penutup ${i + 1}`, p));
  // AI menilai konteks: kata seperti "pasti" bisa aman ("pastikan bersihkan wajah"); klaim tanpa kata terlarang juga bisa berbahaya
  const ai = await claudeJson(
    "Kamu pemeriksa kepatuhan live TikTok Shop Indonesia kategori skincare/kosmetik (aturan TikTok Shop & klaim kosmetik BPOM). Tandai hanya kalimat yang benar-benar berisiko: klaim mutlak/berlebihan, klaim medis/menyembuhkan, janji hasil dalam waktu tertentu, perbandingan menjelekkan merek lain, tekanan beli palsu. Beri kalimat pengganti yang aman. Jangan tandai kalimat yang aman walau memuat kata seperti 'pastikan'.",
    JSON.stringify(isi).slice(0, 60000),
    { type: "object", properties: { temuan: { type: "array", items: { type: "object", properties: { lokasi: { type: "string" }, kalimat: { type: "string" }, alasan: { type: "string" }, ganti: { type: "string" } }, required: ["lokasi", "kalimat", "alasan", "ganti"] } } }, required: ["temuan"] }, 3000);
  return { kata: temuan, ai: ai.temuan || [], aman: !(ai.temuan || []).length };
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
  const ambilKarakter = async (id: string) => (await db.from("ip_karakter").select("*").eq("id", id).maybeSingle()).data;

  try {
    if (b.aksi === "status") {
      const [{ data: karakter }, { data: produk }, { data: akun }, { data: host }, { data: naskah }] = await Promise.all([
        db.from("ip_karakter").select("id, nama, akun_id, host_id, kartu, diubah_at").order("nama"),
        db.from("ip_produk").select("*").eq("aktif", true).order("dibuat_at"),
        db.from("lab_akun").select("id, nama").eq("aktif", true).order("nama"),
        db.from("lab_host").select("id, nama, akun_id").eq("aktif", true).order("nama"),
        db.from("ip_naskah").select("id, karakter_id, judul, versi, induk_id, dibuat_at, cek").order("dibuat_at", { ascending: false }).limit(100),
      ]);
      return balas({ pimpinan: staff.pimpinan, bidang: BIDANG, karakter, produk, akun, host, naskah: (naskah || []).map((n: any) => ({ ...n, aman: n.cek?.aman ?? null, cek: undefined })) });
    }

    if (b.aksi === "karakter-buat") {
      const nama = String(b.nama || "").trim().slice(0, 80);
      if (!nama) return balas({ galat: "NAMA_KOSONG" }, 400);
      const { data, error } = await db.from("ip_karakter").insert({ nama, akun_id: b.akun_id || null, host_id: b.host_id || null, dibuat_oleh: staff.id }).select("id").single();
      if (error) throw error;
      return balas(data);
    }

    if (b.aksi === "karakter-detail") {
      const k = await ambilKarakter(b.id);
      if (!k) return balas({ galat: "TIDAK_ADA" }, 404);
      const [{ data: obrolan }, bukti] = await Promise.all([
        db.from("ip_obrolan").select("id, peran, isi, usulan, dibuat_at").eq("karakter_id", k.id).order("id", { ascending: false }).limit(40),
        buktiLive(k),
      ]);
      return balas({ karakter: k, obrolan: (obrolan || []).reverse(), bukti, bidang: BIDANG });
    }

    // ubah isi satu bidang (manual); mengubah bidang yang sudah terkunci hanya pimpinan
    if (b.aksi === "bidang-ubah") {
      if (!BIDANG[b.bidang]) return balas({ galat: "BIDANG" }, 400);
      const k = await ambilKarakter(b.id);
      if (!k) return balas({ galat: "TIDAK_ADA" }, 404);
      const lama = k.kartu?.[b.bidang] || {};
      if (lama.status === "kunci" && !staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const status = ["draf", "uji", "kunci"].includes(b.status) ? b.status : (lama.status || "draf");
      if (status === "kunci" && !staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const kartu = { ...(k.kartu || {}), [b.bidang]: { isi: b.isi !== undefined ? String(b.isi).slice(0, 4000) : lama.isi || "", status, bukti: b.bukti !== undefined ? String(b.bukti).slice(0, 1000) : lama.bukti || "", oleh: staff.nama, at: new Date().toISOString() } };
      await db.from("ip_karakter").update({ kartu, diubah_at: new Date().toISOString() }).eq("id", k.id);
      return balas({ ok: true, kartu });
    }

    // ngobrol dengan Aura di kartu: Aura bertanya & mengusulkan isi bidang dengan bukti
    if (b.aksi === "obrolan") {
      const k = await ambilKarakter(b.id);
      if (!k) return balas({ galat: "TIDAK_ADA" }, 404);
      const pesan = String(b.pesan || "").trim().slice(0, 3000);
      if (!pesan) return balas({ galat: "KOSONG" }, 400);
      const [{ data: lalu }, bukti] = await Promise.all([db.from("ip_obrolan").select("peran, isi").eq("karakter_id", k.id).order("id", { ascending: false }).limit(16), buktiLive(k)]);
      await db.from("ip_obrolan").insert({ karakter_id: k.id, peran: "user", isi: pesan, staff_id: staff.id });
      const riwayat = (lalu || []).reverse().map((r: any) => `${r.peran === "user" ? "Tim" : "Aura"}: ${r.isi}`).join("\n");
      const hasil = await claudeJson(
        `Kamu Aura, membantu tim Girlhood Den mengembangkan karakter (人设) host live "${k.nama}" seperti MCN China.
Prinsip:
- Karakter diambil dari ORANG ASLINYA, tidak dikarang. Persona akting cepat rusak. Usulan harus berdasar cerita tim atau bukti live.
- Gali dengan panduan: A latar & pengalaman unik, B sifat & pembeda (3 kata diri vs kata teman, sifat yang dibenci sendiri tapi disukai orang = kontras), C nilai (hal yang paling tidak bisa diterima, creator yang dikagumi), D arah (yang ditakutkan saat live, satu hal yang ingin diingat penonton) + 8 cerita.
- Kalimat andalan dicari dari ungkapan yang benar-benar sering diucapkan host (lihat bukti), bukan diciptakan.
- Kalau ada yang belum jelas atau bertentangan, TANYA (maks 2 pertanyaan per giliran, paling penting dulu).
- Usulan hanya untuk bidang yang punya dasar cukup; sebutkan buktinya. Bidang berstatus "kunci" jangan diusulkan ubah kecuali ada bukti kuat bertentangan (jelaskan).
Bahasa Indonesia sehari-hari, singkat.`,
        `KARTU SEKARANG:\n${teksKartu(k.kartu)}\n\nBUKTI DARI LIVE:\n${teksBukti(bukti)}\n\nOBROLAN SEBELUMNYA:\n${riwayat || "-"}\n\nPESAN TIM:\n${pesan}`,
        {
          type: "object",
          properties: {
            balasan: { type: "string", description: "jawaban untuk tim, singkat" },
            pertanyaan: { type: "array", items: { type: "string" }, description: "maks 2 pertanyaan penggali" },
            usulan: { type: "array", items: { type: "object", properties: { bidang: { type: "string", enum: Object.keys(BIDANG) }, isi: { type: "string" }, alasan: { type: "string" }, bukti: { type: "string" } }, required: ["bidang", "isi", "alasan"] } },
          },
          required: ["balasan", "pertanyaan", "usulan"],
        }, 4000);
      const teks = [hasil.balasan, ...(hasil.pertanyaan || []).map((q: string) => "• " + q)].join("\n");
      const { data: simpan } = await db.from("ip_obrolan").insert({ karakter_id: k.id, peran: "assistant", isi: teks, usulan: hasil.usulan || [] }).select("id, peran, isi, usulan, dibuat_at").single();
      return balas(simpan);
    }

    // terima usulan Aura → masuk kartu dengan status "uji" (dibuktikan di live dulu sebelum dikunci)
    if (b.aksi === "usulan-terima") {
      const { data: ob } = await db.from("ip_obrolan").select("karakter_id, usulan").eq("id", b.obrolan_id).single();
      const u = ob?.usulan?.[Number(b.idx)];
      if (!u || !BIDANG[u.bidang]) return balas({ galat: "TIDAK_ADA" }, 404);
      const k = await ambilKarakter(ob.karakter_id);
      if (k.kartu?.[u.bidang]?.status === "kunci" && !staff.pimpinan) return balas({ galat: "KHUSUS_PIMPINAN" }, 403);
      const kartu = { ...(k.kartu || {}), [u.bidang]: { isi: u.isi, status: "uji", bukti: u.bukti || u.alasan, oleh: staff.nama + " (usulan Aura)", at: new Date().toISOString() } };
      const usulan = ob.usulan.map((x: any, i: number) => i === Number(b.idx) ? { ...x, diterima: true } : x);
      await Promise.all([db.from("ip_karakter").update({ kartu, diubah_at: new Date().toISOString() }).eq("id", k.id), db.from("ip_obrolan").update({ usulan }).eq("id", b.obrolan_id)]);
      return balas({ ok: true, kartu });
    }

    if (b.aksi === "produk-simpan") {
      const d = b.data || {};
      const data: any = {};
      for (const k of ["nama", "harga_normal", "harga_live", "promo", "keunggulan", "bahan", "cara_pakai", "bukti", "larangan", "nomor_keranjang"]) data[k] = String(d[k] ?? "").slice(0, 1500);
      if (!data.nama) return balas({ galat: "NAMA_KOSONG" }, 400);
      const q = b.id ? db.from("ip_produk").update({ data, akun_id: b.akun_id || null }).eq("id", b.id) : db.from("ip_produk").insert({ data, akun_id: b.akun_id || null });
      const { error } = await q;
      if (error) throw error;
      return balas({ ok: true });
    }
    if (b.aksi === "produk-hapus") {
      await db.from("ip_produk").update({ aktif: false }).eq("id", b.id);
      return balas({ ok: true });
    }

    if (b.aksi === "naskah-buat" || b.aksi === "naskah-perbarui") {
      let k: any, produkIds: string[], durasi: number, catatan: string, induk: any = null;
      if (b.aksi === "naskah-perbarui") {
        const { data: n } = await db.from("ip_naskah").select("*").eq("id", b.id).single();
        if (!n) return balas({ galat: "TIDAK_ADA" }, 404);
        induk = n; k = await ambilKarakter(n.karakter_id);
        produkIds = n.isi?._produk_ids || []; durasi = n.isi?._durasi || 60; catatan = n.isi?._catatan || "";
      } else {
        k = await ambilKarakter(b.karakter_id);
        produkIds = (Array.isArray(b.produk_ids) ? b.produk_ids : []).slice(0, 15);
        durasi = Math.min(360, Math.max(10, Number(b.durasi) || 60)); catatan = String(b.catatan || "").slice(0, 1500);
      }
      if (!k) return balas({ galat: "TIDAK_ADA" }, 404);
      if (!produkIds.length) return balas({ galat: "TANPA_PRODUK" }, 400);
      const terisi = Object.keys(BIDANG).filter((x) => k.kartu?.[x]?.isi);
      if (!["label", "gaya_bicara"].every((x) => terisi.includes(x))) return balas({ galat: "KARTU_KURANG" }, 400);
      const { data: produk } = await db.from("ip_produk").select("id, data").in("id", produkIds);
      const urut = produkIds.map((id) => (produk || []).find((p: any) => p.id === id)).filter(Boolean);
      const bukti = await buktiLive(k);
      if (induk) bukti.pertanyaan = await pertanyaanPenonton(k.akun_id, induk.dibuat_at); // siklus komentar: pertanyaan sejak versi sebelumnya
      const isi = await tulisNaskah(k, urut, durasi, catatan, bukti, induk ? { ...induk.isi, _produk_ids: undefined } : undefined);
      Object.assign(isi, { _produk_ids: produkIds, _durasi: durasi, _catatan: catatan, _pertanyaan_dipakai: bukti.pertanyaan.slice(0, 10) });
      const cek = await cekNaskah(isi);
      const judul = induk ? induk.judul : (String(b.judul || "").trim().slice(0, 120) || `Sesi ${k.nama} · ${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })}`);
      const { data: n, error } = await db.from("ip_naskah").insert({ karakter_id: k.id, judul, versi: induk ? induk.versi + 1 : 1, induk_id: induk?.id || null, isi, cek, dibuat_oleh: staff.id }).select("id").single();
      if (error) throw error;
      return balas({ id: n.id, cek });
    }

    if (b.aksi === "naskah-detail") {
      const { data: n } = await db.from("ip_naskah").select("*").eq("id", b.id).single();
      if (!n) return balas({ galat: "TIDAK_ADA" }, 404);
      const { data: k } = await db.from("ip_karakter").select("id, nama, kartu").eq("id", n.karakter_id).single();
      return balas({ naskah: n, karakter: k });
    }

    // edit manual satu bagian naskah, lalu cek ulang kalimat berbahaya
    if (b.aksi === "naskah-ubah") {
      const { data: n } = await db.from("ip_naskah").select("id, isi").eq("id", b.id).single();
      if (!n) return balas({ galat: "TIDAK_ADA" }, 404);
      const isi = b.isi && typeof b.isi === "object" ? { ...b.isi, _produk_ids: n.isi._produk_ids, _durasi: n.isi._durasi, _catatan: n.isi._catatan, _pertanyaan_dipakai: n.isi._pertanyaan_dipakai } : n.isi;
      const cek = await cekNaskah(isi);
      await db.from("ip_naskah").update({ isi, cek }).eq("id", n.id);
      return balas({ ok: true, cek });
    }

    if (b.aksi === "naskah-hapus") {
      await db.from("ip_naskah").delete().eq("id", b.id);
      return balas({ ok: true });
    }

    return balas({ galat: "AKSI" }, 400);
  } catch (e) {
    console.error("ip-studio", e);
    return balas({ galat: "GAGAL" }, 500);
  }
});
