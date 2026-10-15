# Profile dan pembanding legacy — 6 Oktober 2026

## Bagian aktif

| Fitur | Implementasi backend | Catatan |
|---|---|---|
| Auth | Register, login, token refresh, recovery lewat Supabase | Konfirmasi email mengikuti project Supabase |
| Profile | Baca/edit nama tampilan dan bio, optimistic concurrency | Migration cloud diterapkan 6 Oktober 2026 |
| Account/access | Role/status/entitlement server-side | Bukan metadata yang bisa diedit user |
| Session/device | Create, rotation, list, rename, revoke, limit | Bearer tidak menggantikan app-session |
| Rules | CRUD owner-scoped, validation subset core, version/hash | Existing; tidak dibuat ulang |
| Universe | Katalog bersama + daftar saham pribadi | Dataset berasal dari universe milik user |
| Dataset | Historical Yahoo adapter/cache, bounded private snapshots | Hak distribusi/provider production masih terbuka |
| Screener A | Client WASM features → server private decisions → WebSocket | Tes fixture tidak berarti live signal/benchmark production |
| Subscription | Plans, state, cancel, operator activation | Checkout/provider/webhook payment belum ada |

Jurnal/portfolio/P&L belum diklaim selesai. Policy transaksi/cost basis perlu
dipastikan sebelum implementasi. Frontend sekarang memakai kontrak multi-series
Model A dengan satu batch/socket; demo login-to-screening tiga saham dengan
akun berizin sudah lolos. Automatic identity refresh masih terbuka.
Lihat [handoff](MODEL_A_FRONTEND_HANDOFF.md).

## Alur tes profile di Postman

1. Login: `POST http://127.0.0.1:8080/api/auth/login`.
2. Buat app-session dengan bearer dari login: `POST /api/v1/sessions`.
3. Baca profile: `GET http://127.0.0.1:8080/api/v1/account/profile`.
4. PATCH URL yang sama memakai version terakhir:

```json
{"display_name":"Lucien","bio":"Belajar analisis saham","version":1}
```

GET/PATCH memerlukan `Authorization: Bearer <access_token>` dan
`X-App-Session: <app_session_token>`. PATCH juga `Content-Type: application/json`.
Success 200 dengan version bertambah; GET berikutnya harus menunjukkan perubahan.
Nama maksimal 100 karakter dan bio 280; field kosong menghapus nilainya.
Profile baru bisa memiliki nama kosong; tidak otomatis mengambil metadata Auth.
Role/email/user_id pada payload ditolak 400, invalid field/version 422,
stale version 409, akun tidak aktif 403, bearer/session hilang 401.
Mengubah profile tidak mengubah respons `/api/auth/me` atau `/account/me`.

Koleksi Postman memiliki folder `03B Editable profile`; jalankan setelah
`00`–`03`. Jangan masukkan password/token ke repository.

## Schema dan rollout

Migration `supabase/migrations/20261006022639_editable_account_profile.sql`
menambah empat kolom ke `signalgen.account_profiles`. Tidak ada table/public
schema baru, tidak ada grant UPDATE kepada browser dan tidak ada perubahan
policy yang memperluas akses. Query pgx memfilter owner dari principal.

Migration tersebut sudah diterapkan ke project Supabase `signalgen-2` pada
6 Oktober 2026; versi file disamakan dengan riwayat deployment Supabase.
Empat kolom dan tiga constraints tersedia; RLS tetap aktif, policy owner tetap
ada, dan role authenticated tidak mendapat UPDATE. Jumlah akun tetap tiga.
`/ready` sengaja 503 apabila kolom profile belum tersedia di lingkungan lain.
Jangan menganggap konfigurasi `.env` atau file SQL sebagai bukti migrasi cloud.
Account auth email sync tidak mengubah profile version atau menimpa nama/bio.

Konfigurasi lokal `backend/.env` sekarang memuat Auth dan koneksi runtime
Postgres dengan role terbatas `signalgen_api`; admin/migration memakai file
terpisah. Komputer teman tetap harus mengisi konfigurasi privat sendiri sesuai
[migration guide](POSTGRES_MIGRATION.md), bukan memakai user `postgres` sebagai
runtime. File `.env` tidak dipush; jangan salin password database ke frontend,
chat atau dokumentasi publik.

## Advisor Supabase yang masih perlu ditindaklanjuti

Pemeriksaan 6 Oktober setelah hardening: peringatan EXECUTE fungsi helper
SECURITY DEFINER publik lama sudah diperbaiki. Tersisa satu WARN leaked-password
protection belum aktif dan tiga INFO tabel arsip dengan RLS tanpa policy.
Password protection memerlukan paket Pro+; tidak ada upgrade berbayar yang
dilakukan. Panduan: [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
dan [hardening](SECURITY_HARDENING.md).
Info RLS tanpa policy pada tabel server-only/arsip bukan alasan membuka policy
browser; pertahankan deny-by-default dan grant minimum.

## Legacy

Source lama sekarang di `legacy/python` dan `legacy/desktop`; panduan menjalankan
ada di `legacy/README.md`. Database root/backend, `.env` backend dan volume
Docker sengaja tidak dipindah/dihapus. Source baru tidak mengubah container
yang sudah berjalan sampai image legacy dibangun ulang secara eksplisit.
Go compatibility SQLite repositories tetap tersedia untuk regression/import
tests, bukan persistence runtime API aktif.
