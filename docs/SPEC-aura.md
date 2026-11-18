# Spec: Aura (girlhoodden.com/aura, dulu "Jarvis")

Peta modul (disetujui skp 18 Nov 2026):

| Modul | Isi | Bergantung |
|---|---|---|
| jarvis-pintu | Halaman /aura, login kode staff + passkey (Face ID/sidik jari; laptop via QR HP) | internal_staff, verify-internal-pin |
| jarvis-palette | Product Palette 360° di dalam Jarvis, data dari Supabase (bukan file publik) | jarvis-pintu |
| jarvis-chat | Chat Jarvis dari Bible, 50 pesan/hari, mati 17.00 kecuali CEO/COO, sesi 16.30 | jarvis-pintu, lark-bot |
| jarvis-sapaan | Sapaan 08.00 + to-do per role | jarvis-chat |

Build order: pintu → palette → chat → sapaan. Dokumen ini merinci **pintu** dan **palette** (V1 tahap 1).

## Objective
Satu halaman internal tempat tim Girlhood Den masuk tanpa mengetik kode tiap hari, lalu memakai alat kerja (mulai dari Product Palette).
Pengguna: staff aktif di `internal_staff` (skp, Gabriella, Ara, Riche, Caca, Zahra, karyawan baru).

## Keputusan teknis
- Hosting: file statis `jarvis.html` di Cloudflare Pages (URL `/aura`), backend Supabase yang sudah ada.
- Login pertama: kode staff lewat `verify-internal-pin` (tidak berubah).
- Passkey: edge function `jarvis-passkey` (WebAuthn, `@simplewebauthn/server`). RP ID `girlhoodden.com`. Kredensial disimpan di `jarvis_passkeys`, challenge di `jarvis_challenges` (kedaluwarsa 5 menit, sekali pakai). Sesi dibuat lewat magic-link token di server, password staff tidak disentuh.
- Laptop tanpa sensor: browser menawarkan "pakai HP" (QR) secara bawaan karena passkey bersifat discoverable.
- Palette: data disimpan di tabel `jarvis_palette` (jsonb), dibaca lewat RPC `jarvis_palette_get()` yang menolak non-internal. Gambar model 360° boleh publik (tidak berisi data bisnis).

## Project Structure
```
aura.html                        → halaman Aura (gerbang login + menu)
assets/aura/palette.html       → Product Palette (dibuka di dalam Jarvis)
assets/aura/spin/f000-f119.jpg → 120 frame model 360°
docs/SPEC-jarvis.md              → dokumen ini
```

## Boundaries
- Always: GRANT eksplisit untuk tabel baru; RLS aktif; semua data bisnis lewat RPC yang cek `is_internal()`.
- Ask first: mengubah alur login kode yang lama, menyentuh sample-request.html / kantor.html.
- Never: menyimpan kode/password di client, membuka data palette tanpa login.

## Success Criteria
1. `/aura` tanpa sesi → layar masuk (tombol Face ID + kolom kode).
2. Masuk dengan kode → menu Jarvis tampil, nama staff tampil, ada tawaran "Aktifkan Face ID".
3. Setelah aktif, keluar lalu masuk lagi cukup Face ID/sidik jari (HP) atau scan QR (laptop).
4. Menu Product Palette menampilkan palette lengkap; tanpa login RPC menolak (`JARVIS_BUKAN_INTERNAL`).
5. Staff nonaktif tidak bisa masuk walau punya passkey.

## Open Questions
- (selesai) Nama: Aura, dipilih skp 18 Nov 2026.
