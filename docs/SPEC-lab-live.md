# Rancangan: Lab Live (Aura)

Status: menunggu persetujuan skp · 25 Nov 2026

## Tujuan
Setiap live akun KIME yang dipegang Saturnine dibedah otomatis: menit mana penonton/order naik, menit mana penonton kabur, dan host sedang bilang/melakukan apa saat itu. Dari ratusan live, Aura mengumpulkan formula (SOP live), daftar "jangan dilakukan", profil host, dan konsep kreatif karakter IP.

Yang dibangun sekarang (tahap 1): **laporan per live**. Tahap 2–3 dibangun setelah tahap 1 terbukti dipakai.

## Bahan (sudah dicek dari dashboard KIME, 25 Nov)
| Bahan | Dari mana | Isi |
|---|---|---|
| Video replay | Dashboard live → Replay → tombol unduh | Video live penuh |
| File ekspor | Dashboard live → Performance trends → tombol unduh (xlsx) | 27 angka (GMV, order, penonton, klik produk, komentar, GPM, dll) **per 30 menit** |
| Screenshot grafik | Dashboard live → Performance trends | Naik-turun **per 5 menit** (dibaca Aura dari gambar) |
| Catatan suara | Orang Saturnine di studio | Hal yang tidak terlihat di video (stok telat, host sakit, dll) |

Replay tersimpan 30 hari, jadi diunggah di hari yang sama.

## Alur tahap 1
1. Live selesai → orang Saturnine buka dashboard live, unduh replay + file ekspor, screenshot grafik.
2. Buka **aplikasi kecil di laptop studio** → pilih akun, host, file video, file ekspor, screenshot → klik **Kirim**.
   Aplikasi mengecilkan video menjadi suara + foto layar tiap 15 detik (±75 MB untuk live 3 jam) lalu mengirim ke Aura.
3. Aura (±30 menit):
   - suara → teks berjam (pengenal suara, ±Rp2.000 per live 3 jam)
   - teks dipotong per topik (pembukaan, jelaskan produk A, jawab komentar, promo, closing…)
   - tiap potongan dipasangkan dengan grafik 5 menit + angka 30 menit
   - tanda 🟢 momen terbaik, 🔴 titik penonton kabur, ⚠️ kalimat berbahaya (klaim berlebihan, tekanan beli)
4. Laporan muncul di Aura menu **Lab Live** + ringkasan ke Lark skp.

## Tampilan laporan per live
- Grafik penonton/GMV di atas, pita warna per topik di bawahnya.
- Klik potongan → foto layar saat itu + teks ucapan host.
- 3 momen terbaik, 3 terburuk, kalimat berbahaya, 1 saran untuk live berikutnya.
- Patokan cepat (live beauty): klik produk < 18% → host lemah menjelaskan; klik→bayar < 5% → host lemah di kepercayaan/closing (patokan ini disesuaikan setelah ada data kita sendiri).

## Tahap berikutnya (setelah tahap 1 dipakai)
- **Tahap 2:** uji coba mingguan (1 perubahan per minggu), bank formula/SOP dari potongan terbaik, daftar "jangan dilakukan".
- **Tahap 3:** profil host, rekomendasi karakter IP, Studio Kreatif (konsep karakter + set + naskah, 2–3 pilihan, diuji di akun laboratorium).

## Akses
- skp: semua akun dan semua laporan.
- Orang Saturnine di Solo: unggah + lihat laporan akun yang dipegang.
- KIME: tidak melihat isi formula.

## Batas
- Bukan real-time saat live; laporan ±30 menit setelah unggah.
- Data dashboard per 5 menit hanya dari screenshot (tidak presisi); detail per menit dari video.
- Data host = data pribadi: tidak ada pengenalan wajah; host dipilih manual saat unggah; host dan KIME diberi tahu live direkam untuk evaluasi.
- Biaya per live 3 jam diperkirakan < Rp20.000 (pengenal suara + AI analisis).

## Ukuran berhasil tahap 1
- Satu live sungguhan diunggah oleh orang Solo dalam < 5 menit kerja.
- Laporan keluar < 45 menit setelah unggah.
- skp setuju minimal 2 dari 3 "momen terbaik/terburuk" memang benar saat dicek di video.

## Pertanyaan terbuka
1. Siapa orang Saturnine di Solo yang mengunggah (nama, mulai kapan)?
2. Akun mana yang jadi 2 akun laboratorium?
3. Laptop studio: Windows atau Mac?

## Pembaruan 25 Nov 2026: akurasi
- Angka dan rasio 五维四率 (masuk live, klik produk, klik ke bayar) dihitung kode dari file ekspor, bukan AI. Diagnosis titik lemah memakai pohon keputusan (berhenti di rasio pertama di bawah patokan).
- Patokan awal 12% / 18% / 5% (referensi live beauty China); otomatis diganti median akun sendiri setelah 5 live selesai.
- Grafik dicek silang ke GMV ekspor (selisih ≤15% = cocok). Bagian transkrip yang kurang jelas ditandai; kata kunci produk per akun dikirim ke Whisper.
- Screenshot: maks 3 grafik + 4 layar lain (sumber penonton, produk). Jam mulai wajib.
- Setiap momen punya tingkat yakin dan tombol Tepat/Kurang tepat; koreksi masuk ke prompt bedah berikutnya. Tab Perbandingan per host/akun menampilkan persentase penilaian AI yang tepat (target >80%).
- Diuji: video 2 jam diolah di browser ±60 detik, unggahan ±26 MB.
- Masih menunggu data dari dashboard: angka per menit dan komentar penonton.
