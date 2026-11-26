# Riset Pasar (Kalodata) di Aura

Tujuan: tim KOL mencari creator, tim BD mencari brand, dari data TikTok Shop Indonesia (Kalodata Open API), lewat satu kunci API di server. Tanpa AI, tanpa saldo Claude.

- Function `riset` (aksi: cek, status, creator-cari, creator-detail, toko-cari, video-cari, incaran-simpan, incaran-ubah, atur).
- Kunci: secret `KALODATA_API_KEY`, header `secret-key`. Region ID, bahasa id-ID, mata uang IDR.
- Kategori tetap: Skincare 848776, Makeup 848648, Parfum 856208.
- Biaya: rank 0,1 kredit per 100 baris, detail 0,1 kredit. 1 kredit ±Rp1.800 (paket 100 = Rp179.820).
- Pengaman: cache `riset_cache` (rank 24 jam, detail 72 jam, gratis saat dipakai ulang), batas kredit per orang per hari (`app_config.riset_batas`, default 3; pimpinan tanpa batas), log `riset_pakai`.
- Akses: pimpinan + `app_config.riset_akses` (diatur di tab Pengaturan).
- Daftar incaran bersama `riset_incaran` (status baru / dihubungi / bergabung / tolak + catatan) supaya creator/brand tidak dihubungi dua kali.
- Catatan Kalodata: rentang wajib "min-max" dua ujung, ujung atas dibatasi; HTTP 554 = dipanggil terlalu cepat (diulang otomatis); urut ads_roas tidak dipakai (ROAS dibatasi 20).
