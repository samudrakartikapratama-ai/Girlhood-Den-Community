# Spec: Studio IP — kartu karakter, penulis naskah, teleprompter

## Tujuan
Satu tempat per IP host: karakternya dikembangkan pelan-pelan bersama Aura sampai "terkunci", lalu Aura menulis poin jualan per produk dengan gaya karakter itu, ditampilkan di teleprompter saat live, dan diperbaiki dari komentar penonton. Tanpa host AI.

## Prinsip (dari MCN China, lihat docs riset "Membangun IP dari 0")
- Karakter diambil dari orang aslinya, tidak dikarang (Wuyou: persona akting cepat rusak). Aura menggali & mengusulkan; data live yang memutuskan; pimpinan yang mengunci.
- Kalimat andalan ditemukan dari kebiasaan asli (Li Jiaqi "Oh my god, beli!"): sistem menghitung ungkapan yang berulang di transkrip live host.
- Teleprompter berisi POIN, bukan naskah kata per kata (Li Jiaqi; kasus naskah Dong Yuhui).
- Setiap naskah dicek kalimat berbahaya (klaim mutlak/medis/tekanan palsu).

## Bagian
1. Kartu Karakter: label, kontras, 8 cerita, kalimat andalan, nama panggung, sapaan penonton, gaya bicara, kategori cocok, target penonton, kata yang dihindari, risiko. Tiap bidang: isi + status (draf / uji / kunci) + catatan bukti. Tim boleh mengubah draf; hanya pimpinan yang mengunci.
2. Ngobrol dengan Aura per kartu: Aura bertanya hal yang belum jelas (panduan wawancara A–D + 8 cerita) dan memberi usulan per bidang dengan alasan & bukti; usulan diterima → status "uji".
   Bukti otomatis: ungkapan berulang dari transkrip Lab Live host, momen terbaik/terburuk/bahaya, pertanyaan penonton dari Pantau Live.
3. Kartu Produk per akun: nama, harga normal, harga live, promo/gimmick, keunggulan, bahan, cara pakai, bukti (BPOM/uji), larangan klaim khusus.
4. Penulis Naskah: pilih karakter + produk + durasi → urutan sesi + kartu poin per produk (pembuka, demo, manfaat, harga, ajakan beli, pancingan interaksi) + jawaban pertanyaan penonton, dengan gaya karakter. Cek bahaya: daftar kata + AI. Bisa diedit manual.
5. Siklus komentar: tombol "Perbarui dari komentar" membuat versi baru yang menjawab pertanyaan penonton terbaru (dari Pantau Live) dan memakai kalimat yang terbukti berhasil.
6. Teleprompter: jendela operator (pengontrol) + layar host (tablet/HP lewat kode). Sinkron lewat Supabase Realtime broadcast; layar host tidak perlu login (konten dikirim dari operator).

## Data
ip_karakter, ip_obrolan, ip_produk, ip_naskah (RLS aktif, akses lewat fungsi ip-studio; akses = pimpinan + lab_live_akses).

## Kriteria selesai
Kartu bisa diisi/diusulkan/dikunci; obrolan menghasilkan usulan; naskah dibuat dan dicek; versi baru dari komentar; teleprompter sinkron dua layar; diuji di browser & model sungguhan.
