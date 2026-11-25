# Spec: Pantau Live (tahap 1) — peringatan saat live berjalan

## Tujuan
Operator live (场控) di studio dapat peringatan dalam ±30–60 detik saat ada masalah, tanpa menunggu bedah setelah live.
Tahap 1 hanya peringatan yang tidak butuh patokan/kalibrasi. Saran gaya jualan menyusul setelah bedah Lab Live terbukti akurat (>80% Tepat).

## Alur
1. Operator buka Aura → Lab Live → Pantau live, pilih akun & host, klik Mulai.
2. Browser minta izin "bagikan layar": operator memilih tab dashboard live TikTok. Suara host diambil dari mikrofon laptop (atau suara tab kalau dicentang saat berbagi).
3. Tiap 30 detik browser mengirim 1 foto layar (dikecilkan) + rekaman suara 30 detik ke server `lab-pantau`.
4. Server: suara → tulisan (Groq Whisper turbo); foto + tulisan → Claude Haiku membaca angka dashboard, komentar yang terlihat, dan menandai kalimat berbahaya.
5. Aturan peringatan dijalankan kode (bukan AI), hasilnya tampil besar di layar operator + bunyi.

## Peringatan tahap 1
| Jenis | Aturan | Jeda ulang |
|---|---|---|
| Kalimat berbahaya | AI menemukan klaim berlebihan/menyesatkan/tekanan palsu di ucapan 30 detik terakhir | tiap kejadian |
| Penonton anjlok | penonton sekarang turun ≥30% dari puncak 3 menit terakhir | 5 menit |
| GMV diam | GMV tidak bertambah 10 menit | 10 menit |
| Lama tidak jualan | 5 menit tanpa menyebut produk/harga/keranjang/promo/kata kunci akun | 5 menit |
| Pertanyaan berulang | pertanyaan penonton yang sama terlihat ≥2 kali | 5 menit |

## Data
- `lab_pantau`: satu sesi pantau (akun, host, operator, mulai, selesai, status).
- `lab_pantau_titik`: satu baris per 30 detik (detik sejak mulai, jam, angka terbaca, ucapan, komentar, peringatan).
- Foto layar dan suara tidak disimpan (hanya hasil bacaannya).
- Bacaan per 30 detik dipakai bedah Lab Live sebagai angka per waktu untuk akun & tanggal yang sama (menutup celah "data per menit").

## Batasan
- Jeda ±30–60 detik, bukan seketika.
- Laptop studio harus tetap menyala dan tab Aura terbuka selama live; layar dijaga tetap menyala (wake lock).
- Angka dibaca dari gambar: kalau tata letak dashboard tertutup/terpotong, nilainya kosong (tidak ditebak).
- Izin KIME untuk membaca dashboard mereka: dikonfirmasi skp.

## Kriteria selesai
- Operator bisa mulai/akhiri pantau; peringatan muncul dengan bunyi; sesi tersimpan.
- Uji browser: berbagi layar, kirim tiap 30 detik, peringatan tampil.
- Bedah Lab Live memakai bacaan pantau bila ada.
