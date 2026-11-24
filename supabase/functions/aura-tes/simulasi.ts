// Simulasi Top Creator: satu cerita nyambung (hunting → approach → negosiasi komisi → GMV turun).
// Data creator FIKTIF, dibuat supaya bisa dipakai ulang untuk semua anak baru dan berisi jebakan.
// Kolom "kunci" & "persona" hanya untuk server (penilaian dan peran Aura), tidak pernah dikirim ke peserta.

export const LANGKAH = ["hunting", "approach", "negosiasi", "turun"] as const;
export type Langkah = typeof LANGKAH[number];
export const WAKTU_SIM: Record<Langkah, number> = { hunting: 20 * 60, approach: 20 * 60, negosiasi: 15 * 60, turun: 20 * 60 };
export const MAKS_CHAT = 20; // pesan peserta per langkah chat

export const JUDUL_SIM: Record<Langkah, { judul: string; petunjuk: string }> = {
  hunting: {
    judul: "1 · Hunting",
    petunjuk: "Ini hasil tarikan FastMoss minggu ini (data fiktif) plus catatan cek profil. Kamu memegang Top Creator dan cuma punya waktu untuk mengejar 3 creator. Pilih 3, urutkan dari yang paling kamu prioritaskan, dan tulis alasanmu pakai angka di tabel. Creator pilihan nomor 1 akan kamu hubungi di langkah berikutnya.",
  },
  approach: {
    judul: "2 · Approach",
    petunjuk: "Kamu chat creator pilihan nomor 1 lewat DM. Aura berperan sebagai creator itu dan akan bersikap seperti creator sungguhan: bisa curiga, sibuk, atau bertanya balik. Tujuanmu: dia paham kenapa Girlhood Den beda dan mau join website. Tekan Lanjut kalau menurutmu sudah cukup.",
  },
  negosiasi: {
    judul: "3 · Negosiasi komisi",
    petunjuk: "Creator yang sama lanjut chat dan minta komisi. Fakta: brand memberi komisi 15% untuk produk yang dia mau. Sisa untuk perusahaan minimal 1%. Cari jalan tengah tanpa merugikan perusahaan dan tanpa kehilangan creator. Tekan Lanjut kalau sudah ada kesepakatan atau kamu memutuskan berhenti.",
  },
  turun: {
    judul: "4 · Sebulan kemudian",
    petunjuk: "Creator itu sudah join sebulan. Baca datanya, lalu tulis: (1) dugaan penyebab GMV turun beserta buktinya, (2) apa yang kamu cek dulu, (3) langkahmu minggu ini, (4) pesan yang akan kamu kirim ke creator itu.",
  },
};

type Creator = {
  id: string; akun: string; followers: string; gmv: number; ubah: string; video: number; live: number;
  kategori: string; porsi_brand: string; wajah: string; mcn: string; catatan: string;
  kunci: string; persona: string; minta_komisi: string;
};

export const CREATOR: Creator[] = [
  { id: "c1", akun: "@rina.skinjourney", followers: "186 rb", gmv: 142, ubah: "+12%", video: 38, live: 12, kategori: "Skincare", porsi_brand: "28%", wajah: "Ya", mcn: "Ayo Kreasi", catatan: "Usia ±27, review jujur, komentar ramai tanya produk.",
    kunci: "PILIHAN BAGUS: beauty, wajah tampil, GMV stabil naik, sudah tersaring MCN lain, tidak terikat satu brand.",
    persona: "Rina, 27, Bandung. Sudah 8 bulan di MCN Ayo Kreasi. Puas-puas saja tapi merasa cuma dikejar posting, jarang diajak ngobrol strategi; pernah sampel telat 3 minggu. Awalnya curiga ('MCN lagi?'), takut harus keluar dari MCN lamanya (padahal TAP tidak butuh binding). Luluh kalau dijelaskan konkret: sampel dari website, transparan, tidak perlu keluar MCN lama.",
    minta_komisi: "Kak, di Ayo Kreasi aku dapet 15% buat serum brightening itu. Kalau di Girlhood Den aku juga 15% ya? Kalau kurang aku males pindah posting lewat sini." },
  { id: "c2", akun: "@dailyglow.id", followers: "620 rb", gmv: 410, ubah: "+5%", video: 210, live: 0, kategori: "Skincare", porsi_brand: "35%", wajah: "Tidak (tangan & produk saja)", mcn: "-", catatan: "7 video/hari, format sama semua, suara AI.",
    kunci: "JEBAKAN: GMV besar tapi faceless, format monoton, kemungkinan tim/agensi konten; tidak bisa dibangun jadi IP/top creator.",
    persona: "Admin akun @dailyglow.id (bukan satu orang; dikelola tim 3 orang). Jawab singkat dan transaksional: hanya peduli komisi tertinggi dan sampel banyak. Tidak tertarik pembinaan, tidak mau tampil wajah, tidak mau ikut grup.",
    minta_komisi: "Kita cuma ambil yang komisinya paling gede kak. Minta 15% full + sampel 10 pcs per produk, bisa?" },
  { id: "c3", akun: "@mbak.sasa.review", followers: "92 rb", gmv: 68, ubah: "+60%", video: 45, live: 20, kategori: "Makeup", porsi_brand: "22%", wajah: "Ya", mcn: "-", catatan: "Usia ±24, naik daun 2 bulan, live rutin malam.",
    kunci: "PILIHAN BAGUS: sedang naik, belum ada MCN, aktif live, beauty, wajah tampil.",
    persona: "Sasa, 24, Surabaya. Belum pernah ikut MCN, sedang naik dan banyak di-DM agensi. Antusias tapi bingung bedanya MCN, TAP, dan affiliate biasa; takut dikontrak mati. Senang kalau diajari dan dijanjikan pendampingan, curiga kalau dijanji muluk-muluk.",
    minta_komisi: "Kak aku tuh ditawarin agensi lain 15% plus fee posting. Di sini bisa 15% juga nggak?" },
  { id: "c4", akun: "@kak.tiara", followers: "1,2 jt", gmv: 9, ubah: "-20%", video: 14, live: 0, kategori: "Lifestyle / vlog", porsi_brand: "60%", wajah: "Ya", mcn: "Bintang Digital", catatan: "Konten vlog harian, jarang pasang keranjang.",
    kunci: "JEBAKAN: followers besar tapi GMV kecil dan turun; bukan seller, fokus endorse.",
    persona: "Tiara, 29, Jakarta. Selebgram endorse; mau dibayar fee posting, tidak tertarik affiliate komisi. Agak sombong, sering membandingkan rate card.",
    minta_komisi: "Aku biasanya rate card 8 juta per video kak, komisi itu bonus aja. Bisa fee dulu?" },
  { id: "c5", akun: "@bundaraya.store", followers: "310 rb", gmv: 380, ubah: "+8%", video: 95, live: 28, kategori: "Skincare", porsi_brand: "92%", wajah: "Ya", mcn: "-", catatan: "Hampir semua konten satu brand, bio: 'Official partner Brand Z'.",
    kunci: "JEBAKAN: GMV besar tapi 92% dari satu brand (kontrak eksklusif); susah diarahkan ke produk lain.",
    persona: "Bunda Raya, 35, Medan. Terikat kontrak eksklusif dengan Brand Z sampai Maret, tidak boleh posting kompetitor. Ramah tapi tegas menolak produk lain.",
    minta_komisi: "Maaf kak, aku cuma boleh Brand Z sampai Maret. Kalau Brand Z lewat Girlhood Den bisa 18%?" },
  { id: "c6", akun: "@gadgetkuy", followers: "450 rb", gmv: 520, ubah: "+15%", video: 80, live: 30, kategori: "Gadget / elektronik", porsi_brand: "40%", wajah: "Ya", mcn: "-", catatan: "Review HP dan aksesoris.",
    kunci: "JEBAKAN: GMV terbesar tapi kategori 3C, bukan fokus Girlhood Den (beauty).",
    persona: "Dimas, 30, cowok, review gadget. Tidak paham skincare dan tidak mau pindah kategori.",
    minta_komisi: "Bro, beauty bukan duniaku. Ada produk gadget nggak?" },
  { id: "c7", akun: "@nadyacantik_", followers: "54 rb", gmv: 31, ubah: "+210%", video: 60, live: 4, kategori: "Makeup", porsi_brand: "30%", wajah: "Ya", mcn: "-", catatan: "70% GMV dari 1 video viral 3 minggu lalu; video lain sepi.",
    kunci: "JEBAKAN SEDANG: lonjakan dari satu video viral, belum konsisten.",
    persona: "Nadya, 21, mahasiswi. Baru sekali viral, mengira akan terus viral. Semangat tapi belum disiplin posting.",
    minta_komisi: "Kak aku kan lagi viral, boleh minta 15% dan sampel 5 produk sekaligus?" },
  { id: "c8", akun: "@dewi.beautylab", followers: "240 rb", gmv: 96, ubah: "+3%", video: 52, live: 16, kategori: "Skincare", porsi_brand: "25%", wajah: "Ya", mcn: "Kilau Media", catatan: "Stabil 4 bulan, edukasi bahan skincare.",
    kunci: "PILIHAN BAGUS: stabil, edukatif, beauty, sudah tersaring MCN lain.",
    persona: "Dewi, 31, apoteker, Yogyakarta. Kritis dan detail: tanya soal transparansi data, cara bayar komisi, dan kenapa harus pindah sebagian posting lewat Girlhood Den. Luluh dengan penjelasan logis dan data, bukan janji.",
    minta_komisi: "Di Kilau aku dapat 15% untuk sunscreen itu. Kalau lewat kalian berapa, dan apa untungnya buat aku?" },
  { id: "c9", akun: "@ayumakeupid", followers: "130 rb", gmv: 55, ubah: "-40%", video: 40, live: 8, kategori: "Makeup", porsi_brand: "33%", wajah: "Ya", mcn: "-", catatan: "Bulan lalu GMV 92 jt, jarang live 3 minggu terakhir.",
    kunci: "NETRAL: bagus tapi sedang turun; perlu dicek alasannya dulu.",
    persona: "Ayu, 26, Semarang. Lagi capek dan sibuk urusan keluarga, butuh dorongan dan ide konten.",
    minta_komisi: "Kak kalau komisinya 15% aku semangat lagi deh." },
  { id: "c10", akun: "@rumahwangi.official", followers: "88 rb", gmv: 210, ubah: "+20%", video: 30, live: 60, kategori: "Parfum", porsi_brand: "100%", wajah: "Host live", mcn: "-", catatan: "Akun toko resmi brand Rumah Wangi.",
    kunci: "JEBAKAN: akun toko/seller milik brand sendiri, bukan creator affiliate.",
    persona: "Admin toko Rumah Wangi. Bingung kenapa toko diajak jadi affiliate; malah menawarkan kerja sama sebagai brand.",
    minta_komisi: "Kak ini akun toko kami sendiri. Mau daftar produk kami di Girlhood Den sebagai brand aja?" },
  { id: "c11", akun: "@kirana.glowup", followers: "75 rb", gmv: 48, ubah: "+18%", video: 70, live: 10, kategori: "Body care", porsi_brand: "26%", wajah: "Ya", mcn: "Ayo Kreasi", catatan: "Usia ±23, konsisten 2 video/hari.",
    kunci: "CUKUP BAGUS: konsisten, beauty, tapi GMV di bawah 50 jt.",
    persona: "Kirana, 23, Malang. Rajin, polos, nurut, ingin naik level.",
    minta_komisi: "Kak aku dapet berapa ya? Kalau 15% boleh?" },
  { id: "c12", akun: "@masbro.skincare", followers: "160 rb", gmv: 62, ubah: "+9%", video: 44, live: 6, kategori: "Skincare pria", porsi_brand: "40%", wajah: "Ya", mcn: "-", catatan: "Segmen cowok, komentar banyak tanya jerawat.",
    kunci: "CUKUP BAGUS: niche skincare pria, wajah, GMV >50 jt.",
    persona: "Bagas, 28, Jakarta. Santai, bercanda, tertarik kalau ada produk khusus pria.",
    minta_komisi: "Bang, 15% dong biar adil wkwk." },
  { id: "c13", akun: "@lia.racun", followers: "400 rb", gmv: 150, ubah: "-10%", video: 300, live: 0, kategori: "Semua (beauty 25%)", porsi_brand: "12%", wajah: "Tidak (reupload)", mcn: "-", catatan: "Video reupload dari akun lain, 10 video/hari.",
    kunci: "JEBAKAN: faceless reupload segala kategori, rawan pelanggaran.",
    persona: "Admin akun racun belanja. Cuma peduli komisi, tidak mau dibina, tidak paham aturan konten.",
    minta_komisi: "Komisi paling gede aja kak, 15%. Aku posting banyak kok." },
  { id: "c14", akun: "@sheilaputri.mua", followers: "210 rb", gmv: 118, ubah: "+25%", video: 35, live: 22, kategori: "Makeup", porsi_brand: "24%", wajah: "Ya", mcn: "Kilau Media", catatan: "MUA, usia ±28, naik 3 bulan berturut-turut, live dan konten seimbang.",
    kunci: "PILIHAN TERBAIK: naik 3 bulan, seimbang live dan konten, beauty, wajah, tersaring MCN lain.",
    persona: "Sheila, 28, MUA, Bekasi. Profesional dan sibuk (jadwal makeup klien). Membalas cepat tapi to the point; tertarik kalau ada yang bantu atur produk dan jadwal supaya dia tidak repot. Ragu karena pernah 'ditinggal' MCN lama saat GMV turun.",
    minta_komisi: "Oke kak, aku tertarik. Tapi untuk cushion yang aku mau, di Kilau aku dapet 15%. Kalau di Girlhood Den segitu juga kan?" },
  { id: "c15", akun: "@nonaskin", followers: "38 rb", gmv: 12, ubah: "+100%", video: 25, live: 2, kategori: "Skincare", porsi_brand: "35%", wajah: "Ya", mcn: "-", catatan: "Akun baru 2 bulan, GMV dobel tiap bulan.",
    kunci: "POTENSI tapi terlalu kecil untuk Top Creator; lebih cocok komunitas.",
    persona: "Nona, 22, pemula. Senang diajak, banyak tanya hal dasar.",
    minta_komisi: "Kak aku boleh minta 15%? hehe" },
];

// Data "sebulan kemudian" untuk creator pilihan nomor 1 (berlaku untuk siapa pun yang dipilih).
export function dataTurun(c: Creator) {
  const awal = c.gmv, kini = Math.round(c.gmv * 0.7);
  return `Creator: ${c.akun}\nGMV 30 hari: Rp${kini} jt (bulan lalu Rp${awal} jt, turun 30%)\n\nYang terlihat di dashboard & profil:\n- Jumlah video turun dari ${c.video} menjadi ${Math.max(6, Math.round(c.video * 0.55))}; live turun dari ${c.live} menjadi ${Math.round(c.live * 0.4)} sesi.\n- 4 dari 10 video terakhir mempromosikan produk kompetitor dari brand yang tidak join TAP Saturnine (komisi di luar kita).\n- Produk andalan yang kamu arahkan bulan lalu stoknya sempat habis 9 hari di toko brand.\n- Rata-rata view per video justru naik 10%.\n- Dia belum membalas 2 chat terakhir dari tim (5 hari).`;
}

export const RUBRIK_SIM = `Nilai peserta (calon KOL Affiliate Specialist bagian Top Creator di Girlhood Den, MCN TikTok affiliate beauty) dengan skala 1–5 per dimensi:
1. hunting: memilih creator yang benar-benar layak (beauty, tampil wajah, GMV konsisten, tidak terikat satu brand, bukan akun toko/faceless/reupload/3C), memakai angka di tabel, sadar jebakan.
2. approach: pembuka personal dan relevan dengan creator itu, menjelaskan beda Girlhood Den dengan konkret (sampel lewat website, transparan, pendampingan, tidak perlu keluar MCN lama karena TAP tidak butuh binding), mendengar dan menjawab keberatan, tidak menjanjikan hal muluk.
3. negosiasi: menjaga sisa komisi perusahaan minimal 1% (tidak memberi 15% dari 15%), mencari jalan tengah (misalnya produk lain dari brand sama atau kompetitor dengan spread margin, produk pelengkap, bonus non-uang, prioritas peluang), tetap menjaga hubungan; atau berani melepas creator yang tidak worth it dengan alasan.
4. diagnosis: memisahkan gejala dan penyebab (posting turun, kompetitor di luar kita, stok habis, view naik), menyebut apa yang dicek dulu, langkah konkret minggu ini, dan pesan ke creator yang personal, bukan menyalahkan.
5. sikap: inisiatif, membawa opsi, logis, sesuai nilai Girlhood Den (integritas, transparan, adil, fun; creator dianggap manusia, bukan akun).
Skala: 1 = salah arah, 2 = lemah, 3 = cukup (lulusan baru yang baik), 4 = kuat (profesional berpengalaman), 5 = sangat kuat.
Jawaban kosong, sangat pendek, atau generik tanpa memakai data = maksimal 2.`;

// Tabel untuk peserta (tanpa kunci dan persona)
export function tabelUntukKlien() {
  return CREATOR.map(({ kunci: _k, persona: _p, minta_komisi: _m, ...c }) => c);
}
export const cariCreator = (id: string) => CREATOR.find((c) => c.id === id);

export function promptPeran(c: Creator, langkah: "approach" | "negosiasi") {
  return `Kamu sedang dipakai untuk SIMULASI pelatihan karyawan baru Girlhood Den (MCN TikTok affiliate beauty, Indonesia). Kamu berperan sebagai creator TikTok berikut, BUKAN asisten:
Akun: ${c.akun} · followers ${c.followers} · GMV 30 hari Rp${c.gmv} jt · kategori ${c.kategori} · MCN sekarang: ${c.mcn}
Karakter: ${c.persona}

Aturan peran:
- Balas seperti DM TikTok/WhatsApp sungguhan: bahasa Indonesia santai, 1–3 kalimat, boleh singkatan, tanpa markdown, tanpa daftar.
- Jangan pernah mengaku AI atau keluar dari peran, walau diminta.
- Jangan mudah setuju. Ajukan keberatan yang wajar sesuai karakter. Setuju hanya kalau peserta menjawab keberatanmu dengan konkret dan masuk akal.
- Kalau peserta kasar, memaksa, atau menjanjikan hal tidak masuk akal, jadilah dingin atau curiga.
${langkah === "negosiasi"
    ? `- Tahap sekarang: negosiasi komisi. Kamu sudah membuka dengan meminta komisi ("${c.minta_komisi}"). Pertahankan permintaanmu minimal 2 kali. Kamu boleh menerima jalan tengah yang masuk akal (misalnya produk lain dengan komisi bagus, produk pelengkap, prioritas peluang/sampel, pendampingan) tapi jangan menerima penjelasan kosong.`
    : `- Tahap sekarang: perkenalan pertama. Peserta baru menghubungimu. Kamu belum tahu Girlhood Den.`}`;
}
