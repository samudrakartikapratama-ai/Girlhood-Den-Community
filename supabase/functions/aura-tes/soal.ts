// Bank soal tes tim Aura. Semua soal orisinal (bukan salinan tes berlisensi), disusun mengikuti format
// asesmen yang lazim dipakai kampus & perusahaan top: gaya kerja ala DISC (pilihan paksa), penalaran
// numerik & logika ala Watson-Glaser / GMAT (critical reasoning, data sufficiency), dan studi kasus ala
// wawancara konsultan. KUNCI JAWABAN HANYA ADA DI SERVER: klien hanya menerima soal tanpa kunci.

export const WAKTU = { gaya: 12 * 60, logika: 30 * 60, kasus: 40 * 60 }; // detik
export const URUTAN = ["gaya", "logika", "kasus"] as const;
export type Bagian = typeof URUTAN[number];

export const JUDUL: Record<Bagian, { judul: string; petunjuk: string }> = {
  gaya: {
    judul: "Bagian 1 · Gaya kerja",
    petunjuk: "Di tiap kelompok, pilih SATU pernyataan yang PALING menggambarkan kamu dan SATU yang PALING TIDAK menggambarkan kamu. Tidak ada jawaban benar atau salah. Jawab jujur dan cepat, jangan jawab sesuai yang menurutmu diharapkan.",
  },
  logika: {
    judul: "Bagian 2 · Logika & angka",
    petunjuk: "20 soal pilihan ganda dengan tingkat kesulitan bertahap. Boleh pakai kertas coret-coretan, tidak boleh pakai kalkulator atau AI. Soal yang tidak dijawab dianggap salah, jadi tetap pilih jawaban terbaikmu.",
  },
  kasus: {
    judul: "Bagian 3 · Studi kasus",
    petunjuk: "3 kasus kerja nyata. Tidak ada jawaban tunggal yang benar: yang dinilai cara berpikirmu (urutan, pakai data, akar masalah, opsi beserta risikonya, langkah konkret). Tulis poin-poin singkat, tidak perlu kalimat panjang.",
  },
};

// ---------- Bagian 1: gaya kerja (D = dominan/hasil, I = pengaruh/orang, S = stabil/tim, C = cermat/aturan) ----------
type Dim = "D" | "I" | "S" | "C";
export const GAYA: { id: string; opsi: { id: string; teks: string; dim: Dim }[] }[] = [
  ["Tegas mengambil keputusan", "Mudah akrab dengan orang baru", "Sabar mendengarkan", "Teliti sebelum bertindak"],
  ["Suka tantangan", "Antusias", "Konsisten", "Rapi dan terstruktur"],
  ["Langsung ke inti", "Pandai meyakinkan orang", "Menjaga suasana tetap tenang", "Mengikuti aturan"],
  ["Berani ambil risiko", "Suka tampil di depan", "Setia pada tim", "Analitis"],
  ["Kompetitif", "Optimis", "Mudah menyesuaikan diri", "Hati-hati"],
  ["Mengejar hasil", "Suka ngobrol", "Suka menolong", "Akurat"],
  ["Mandiri", "Spontan", "Tenang", "Logis"],
  ["Cepat bertindak", "Ekspresif", "Bisa diandalkan", "Perfeksionis"],
  ["Suka memimpin", "Menyenangkan", "Cinta damai", "Sistematis"],
  ["Gigih", "Menginspirasi", "Penuh pertimbangan", "Kritis"],
  ["Berterus terang", "Mudah bergaul", "Rendah hati", "Berpegang pada fakta"],
  ["Tidak suka bertele-tele", "Penuh ide", "Suka rutinitas yang jelas", "Detail"],
  ["Menetapkan target tinggi", "Membangkitkan semangat orang", "Menjaga hubungan baik", "Memeriksa ulang pekerjaan"],
  ["Berani berdebat", "Mudah percaya", "Menghindari konflik", "Ragu sampai ada bukti"],
  ["Ingin hasil cepat", "Suka hal baru", "Suka kestabilan", "Suka prosedur yang pasti"],
  ["Menantang cara lama", "Pencerita yang baik", "Pendengar yang baik", "Perencana yang matang"],
  ["Tegas pada orang yang lambat", "Mudah memuji orang", "Memaklumi kesalahan orang", "Menunjukkan kesalahan dengan data"],
  ["Mengambil alih saat situasi kacau", "Mencairkan suasana saat tegang", "Menenangkan orang saat panik", "Mencari penyebab saat ada masalah"],
  ["Paling semangat kalau ada target", "Paling semangat kalau banyak orang", "Paling semangat kalau timnya solid", "Paling semangat kalau aturannya jelas"],
  ["Tidak sabaran", "Mudah teralihkan", "Lambat menerima perubahan", "Terlalu lama menimbang"],
  ["Keras kepala", "Kurang detail", "Sulit menolak permintaan", "Terlalu mengkritik"],
  ["Ingin dinilai dari hasil", "Ingin dinilai dari pengaruh ke orang", "Ingin dinilai dari kesetiaan", "Ingin dinilai dari kualitas kerja"],
  ["\"Ayo kerjakan sekarang\"", "\"Ayo bikin seru\"", "\"Pelan-pelan asal pasti\"", "\"Cek datanya dulu\""],
  ["Senang kalau menang", "Senang kalau diakui", "Senang kalau merasa aman", "Senang kalau benar"],
].map((b, i) => ({
  id: "g" + (i + 1),
  opsi: (["D", "I", "S", "C"] as Dim[]).map((dim, j) => ({ id: "g" + (i + 1) + "_" + "abcd"[j], teks: b[j], dim })),
}));

// ---------- Bagian 2: logika & angka ----------
const TABEL = "Tabel GMV tiga brand di jaringan agensi (Rp juta):\nBrand A: Agustus 400 · September 500 · Oktober 450\nBrand B: Agustus 250 · September 300 · Oktober 390\nBrand C: Agustus 150 · September 120 · Oktober 160\nKomisi bersih untuk agensi: A 2% · B 3% · C 1,5% dari GMV.";
const POLA = "Untuk soal ini, anggap semua pernyataan di atas BENAR. Pilih apakah kesimpulannya pasti benar, pasti salah, atau tidak bisa dipastikan.";
const TIGA = [["a", "Pasti benar"], ["b", "Pasti salah"], ["c", "Tidak bisa dipastikan"]];
const CUKUP = [["a", "Pernyataan (1) saja cukup"], ["b", "Pernyataan (2) saja cukup"], ["c", "Keduanya bersama cukup, masing-masing saja tidak"], ["d", "Keduanya bersama pun belum cukup"]];

type SoalLogika = { id: string; level: 1 | 2 | 3; jenis: string; stem?: string; tanya: string; opsi: string[][]; kunci: string };
export const LOGIKA: SoalLogika[] = [
  { id: "l1", level: 1, jenis: "angka", stem: TABEL, tanya: "Berapa total GMV ketiga brand di bulan Oktober?", opsi: [["a", "Rp950 juta"], ["b", "Rp1.000 juta"], ["c", "Rp1.050 juta"], ["d", "Rp920 juta"]], kunci: "b" },
  { id: "l2", level: 2, jenis: "angka", stem: TABEL, tanya: "Brand mana yang pertumbuhan GMV-nya (dalam persen) paling tinggi dari Agustus ke Oktober?", opsi: [["a", "Brand A"], ["b", "Brand B"], ["c", "Brand C"], ["d", "A dan C sama tinggi"]], kunci: "b" },
  { id: "l3", level: 2, jenis: "angka", stem: TABEL, tanya: "Berapa total komisi bersih agensi dari ketiga brand di bulan Oktober?", opsi: [["a", "Rp20,0 juta"], ["b", "Rp23,1 juta"], ["c", "Rp25,4 juta"], ["d", "Rp21,6 juta"]], kunci: "b" },
  { id: "l4", level: 3, jenis: "angka", stem: TABEL, tanya: "Jika di November Brand B tumbuh dengan persentase yang sama seperti September ke Oktober, berapa GMV Brand B di November?", opsi: [["a", "Rp480 juta"], ["b", "Rp507 juta"], ["c", "Rp520 juta"], ["d", "Rp468 juta"]], kunci: "b" },
  { id: "l5", level: 3, jenis: "angka", stem: TABEL, tanya: "Agensi ingin komisi bersih November minimal Rp30 juta. GMV A dan C sama seperti Oktober (komisinya juga sama), GMV B = Rp507 juta. Kira-kira berapa persen komisi B minimal yang harus dinegosiasikan?", opsi: [["a", "3,0%"], ["b", "3,4%"], ["c", "3,7%"], ["d", "4,2%"]], kunci: "c" },
  { id: "l6", level: 1, jenis: "deduksi", stem: "Semua creator tier Gold punya GMV minimal Rp50 juta per bulan. Dina punya GMV Rp40 juta bulan ini.\n" + POLA, tanya: "Kesimpulan: Dina bukan creator tier Gold bulan ini.", opsi: TIGA, kunci: "a" },
  { id: "l7", level: 2, jenis: "deduksi", stem: "Sebagian creator live adalah creator Diamond. Semua creator Diamond mendapat harta karun.\n" + POLA, tanya: "Kesimpulan: Sebagian creator live mendapat harta karun.", opsi: TIGA, kunci: "a" },
  { id: "l8", level: 2, jenis: "deduksi", stem: "Tidak ada brand yang di-freeze yang boleh menerima request sampel. Sebagian brand skincare di-freeze.\n" + POLA, tanya: "Kesimpulan: Semua brand skincare tidak boleh menerima request sampel.", opsi: TIGA, kunci: "c" },
  { id: "l9", level: 3, jenis: "deduksi", stem: "Jika sebuah brand ikut campaign payday, GMV brand itu naik di minggu payday. Minggu payday ini GMV brand Z tidak naik.\n" + POLA, tanya: "Kesimpulan: Brand Z tidak ikut campaign payday.", opsi: TIGA, kunci: "a" },
  { id: "l10", level: 3, jenis: "deduksi", stem: "Jika creator posting paling lambat H+3, ia mendapat poin. Rina mendapat poin minggu ini.\n" + POLA, tanya: "Kesimpulan: Rina posting paling lambat H+3.", opsi: TIGA, kunci: "c" },
  { id: "l11", level: 2, jenis: "asumsi", stem: "Manajer: \"Kita harus merekrut 50 creator baru bulan depan supaya GMV naik 20%.\"", tanya: "Asumsi apa yang PALING diperlukan agar argumen manajer masuk akal?", opsi: [["a", "Creator baru bisa menghasilkan penjualan yang cukup dalam bulan pertama"], ["b", "Creator lama akan berhenti bulan depan"], ["c", "Brand akan menaikkan komisi bulan depan"], ["d", "TikTok akan menambah traffic kategori beauty"]], kunci: "a" },
  { id: "l12", level: 3, jenis: "melemahkan", stem: "\"Tiga bulan setelah website diluncurkan, GMV kita naik 40%. Jadi website-lah yang menyebabkan kenaikan GMV.\"", tanya: "Fakta mana yang PALING melemahkan kesimpulan itu?", opsi: [["a", "Banyak creator memuji tampilan website"], ["b", "Dalam tiga bulan yang sama, GMV seluruh kategori beauty di TikTok naik 45%"], ["c", "Biaya pembuatan website cukup besar"], ["d", "Beberapa brand belum memakai website"]], kunci: "b" },
  { id: "l13", level: 3, jenis: "menguatkan", stem: "\"Creator yang menerima contoh video laku menghasilkan GMV dua kali lebih tinggi daripada yang tidak. Jadi contoh video meningkatkan penjualan.\"", tanya: "Fakta mana yang PALING menguatkan kesimpulan itu?", opsi: [["a", "Contoh video dikirim secara acak, bukan dipilih berdasarkan performa creator sebelumnya"], ["b", "Creator top lebih sering meminta contoh video"], ["c", "Contoh video dibuat oleh tim internal"], ["d", "Sebagian creator tidak menonton contoh video yang dikirim"]], kunci: "a" },
  { id: "l14", level: 2, jenis: "inferensi", stem: "Bulan lalu ada 400 request sampel: 300 hangus karena tidak dijawab brand, 60 disetujui, dan 40 ditolak.", tanya: "Pernyataan mana yang PASTI benar berdasarkan data itu?", opsi: [["a", "Brand lebih banyak menolak daripada menyetujui"], ["b", "Hanya seperempat request yang dijawab brand"], ["c", "Creator kurang serius membuat request"], ["d", "Request yang disetujui pasti menghasilkan penjualan"]], kunci: "b" },
  { id: "l15", level: 1, jenis: "pola", tanya: "Lanjutkan deret: 2, 6, 12, 20, 30, …", opsi: [["a", "40"], ["b", "42"], ["c", "44"], ["d", "36"]], kunci: "b" },
  { id: "l16", level: 2, jenis: "pola", tanya: "Lanjutkan deret: 3, 5, 9, 17, 33, …", opsi: [["a", "64"], ["b", "65"], ["c", "66"], ["d", "49"]], kunci: "b" },
  { id: "l17", level: 3, jenis: "pola", tanya: "Lanjutkan deret huruf: A, C, F, J, O, …", opsi: [["a", "T"], ["b", "U"], ["c", "V"], ["d", "S"]], kunci: "b" },
  { id: "l18", level: 3, jenis: "kecukupan data", stem: "Pertanyaan: Berapa GMV creator X bulan ini?\n(1) X menjual 120 order bulan ini.\n(2) Rata-rata nilai per order X bulan ini Rp85.000.", tanya: "Data mana yang cukup untuk menjawab pertanyaan?", opsi: CUKUP, kunci: "c" },
  { id: "l19", level: 3, jenis: "kecukupan data", stem: "Pertanyaan: Apakah GMV brand P bulan ini lebih besar dari brand Q?\n(1) GMV P bulan ini naik 20% dari bulan lalu.\n(2) Bulan lalu GMV P sama dengan GMV Q, dan bulan ini GMV Q turun.", tanya: "Data mana yang cukup untuk menjawab pertanyaan?", opsi: CUKUP, kunci: "c" },
  { id: "l20", level: 2, jenis: "prioritas", stem: "Kamu punya 10 jam minggu ini. Pilihan pekerjaan:\nA: 4 jam, tambahan GMV Rp40 jt\nB: 2 jam, tambahan GMV Rp30 jt\nC: 5 jam, tambahan GMV Rp45 jt\nD: 3 jam, tambahan GMV Rp15 jt\nSetiap pekerjaan hanya bisa diambil sekali.", tanya: "Kombinasi mana yang memberi tambahan GMV terbesar tanpa melebihi 10 jam?", opsi: [["a", "A + C"], ["b", "B + C + D"], ["c", "A + B + D"], ["d", "A + B + C"]], kunci: "b" },
];

// ---------- Bagian 3: studi kasus ----------
export const KASUS = [
  { id: "k1", judul: "GMV brand turun", teks: "Hari ini Senin. GMV Hanasui di jaringan kita turun dari Rp120 juta minggu lalu menjadi Rp70 juta minggu ini. Jumlah creator yang posting Hanasui tetap sekitar 45 orang. Besok pagi kamu harus lapor ke CEO.\n\nApa saja yang kamu cek, dengan urutan seperti apa, dan 2–3 opsi apa yang kamu bawa ke CEO (beserta risikonya)?" },
  { id: "k2", judul: "Membagi waktu", teks: "Kamu memegang 30 creator. 6 creator menyumbang 70% GMV, 24 lainnya rata-rata Rp3 juta per bulan. Waktumu 20 jam per minggu untuk mengurus creator.\n\nBagaimana kamu membagi waktumu dan kenapa? Apa risikonya kalau pembagianmu salah, dan bagaimana kamu tahu dalam 2 minggu apakah pembagianmu sudah benar?" },
  { id: "k3", judul: "Estimasi potensi", teks: "Perkirakan: berapa potensi GMV per bulan dari produk sunscreen yang bisa dihasilkan jaringan Girlhood Den kalau kita punya 300 creator aktif?\n\nTunjukkan asumsi dan hitunganmu langkah demi langkah. Angkanya tidak harus tepat; yang dinilai cara kamu memecah masalah dan apakah asumsinya masuk akal." },
];

export const RUBRIK = `Nilai setiap jawaban kasus dengan skala 1–5 untuk 5 dimensi (standar wawancara kasus konsultan top & tes penerimaan management trainee):
1. struktur: jawaban terurut, tidak tumpang-tindih, mencakup hal penting (MECE).
2. data: memakai angka di soal, membandingkan, menghitung; bukan opini kosong.
3. akar_masalah: membedakan gejala dan penyebab; memisahkan yang bisa dikontrol dan yang tidak.
4. opsi: membawa 2–3 pilihan beserta risiko/trade-off dan rekomendasi yang jelas.
5. eksekusi: langkah konkret, siapa/kapan, dan ukuran berhasil.
Skala: 1 = tidak ada/salah arah, 2 = lemah, 3 = cukup (setara lulusan baru yang baik), 4 = kuat (setara profesional berpengalaman), 5 = sangat kuat (jarang, setara top consultant).
Jawaban kosong, sangat pendek, atau jelas hasil salinan AI/generik tanpa pakai angka soal = maksimal 2.`;

// Versi soal tanpa kunci untuk dikirim ke klien
export function soalUntukKlien(b: Bagian) {
  if (b === "gaya") return GAYA.map((g) => ({ id: g.id, opsi: g.opsi.map((o) => ({ id: o.id, teks: o.teks })) }));
  if (b === "logika") return LOGIKA.map((s) => ({ id: s.id, level: s.level, jenis: s.jenis, stem: s.stem || "", tanya: s.tanya, opsi: s.opsi.map(([id, teks]) => ({ id, teks })) }));
  return KASUS;
}

// ---------- Penilaian ----------
export function nilaiGaya(j: Record<string, { paling?: string; bukan?: string }>) {
  const skor: Record<Dim, number> = { D: 0, I: 0, S: 0, C: 0 };
  let lengkap = 0;
  for (const g of GAYA) {
    const a = j?.[g.id];
    const p = g.opsi.find((o) => o.id === a?.paling), b = g.opsi.find((o) => o.id === a?.bukan);
    if (p) skor[p.dim]++;
    if (b) skor[b.dim]--;
    if (p && b && p.id !== b.id) lengkap++;
  }
  const urut = (Object.keys(skor) as Dim[]).sort((x, y) => skor[y] - skor[x]);
  return { skor, utama: urut[0], kedua: urut[1], lengkap, total: GAYA.length };
}

export function nilaiLogika(j: Record<string, string>) {
  let benar = 0, bobot = 0, bobotMaks = 0;
  const perJenis: Record<string, { benar: number; total: number }> = {};
  const perLevel: Record<string, { benar: number; total: number }> = {};
  for (const s of LOGIKA) {
    const ok = j?.[s.id] === s.kunci;
    bobotMaks += s.level;
    if (ok) { benar++; bobot += s.level; }
    const k = s.jenis.startsWith("deduksi") ? "deduksi" : ["asumsi", "melemahkan", "menguatkan", "inferensi"].includes(s.jenis) ? "penalaran kritis" : s.jenis;
    perJenis[k] = perJenis[k] || { benar: 0, total: 0 }; perJenis[k].total++; if (ok) perJenis[k].benar++;
    const l = "level " + s.level;
    perLevel[l] = perLevel[l] || { benar: 0, total: 0 }; perLevel[l].total++; if (ok) perLevel[l].benar++;
  }
  const persen = Math.round(100 * bobot / bobotMaks);
  return { benar, total: LOGIKA.length, persen_berbobot: persen, perJenis, perLevel, kategori: persen >= 75 ? "tajam" : persen >= 55 ? "cukup" : "lemah" };
}

export const ARTI_GAYA: Record<Dim, string> = {
  D: "Dominan: mengejar hasil, cepat memutuskan, berani konfrontasi. Risiko: tidak sabaran, kurang mendengar.",
  I: "Pengaruh: pandai membangun hubungan dan meyakinkan, energik. Risiko: kurang detail, mudah teralihkan.",
  S: "Stabil: setia, sabar, menjaga hubungan jangka panjang. Risiko: lambat berubah, sulit menolak, menghindari konflik.",
  C: "Cermat: analitis, teliti, berbasis data dan aturan. Risiko: terlalu lama menimbang, terlalu kritis.",
};
