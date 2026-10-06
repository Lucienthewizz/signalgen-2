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
dipastikan sebelum implementasi. Frontend masih perlu mengikuti kontrak multi-
series Model A yang didokumentasikan di `MODEL_A_FRONTEND_HANDOFF.md`.

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

Konfigurasi lokal `backend/.env` saat deployment ini hanya memuat URL/key Auth.
Untuk menjalankan Go dari checkout ini atau komputer teman, isi juga
`SUPABASE_DB_URL` dari Connect → session pooler secara privat. File `.env` tidak
dipush; jangan salin password database ke frontend, chat atau dokumentasi publik.

## Advisor Supabase yang masih perlu ditindaklanjuti

Pemeriksaan setelah migration tidak menambah warning baru. Advisor masih
melaporkan EXECUTE fungsi SECURITY DEFINER lama `public.handle_new_user`
(return type trigger) dan `public.rls_auto_enable` (event_trigger) bagi client
roles, serta leaked-password protection yang belum aktif. Fungsi/settings lama
ini tidak diubah dalam deployment profile; audit konfigurasi terpisah diperlukan.
Panduan: [function privileges](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
dan [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Info RLS tanpa policy pada tabel server-only/arsip bukan alasan membuka policy
browser; pertahankan deny-by-default dan grant minimum.

## Legacy

Source lama sekarang di `legacy/python` dan `legacy/desktop`; panduan menjalankan
ada di `legacy/README.md`. Database root/backend, `.env` backend dan volume
Docker sengaja tidak dipindah/dihapus. Source baru tidak mengubah container
yang sudah berjalan sampai image legacy dibangun ulang secara eksplisit.
Go compatibility SQLite repositories tetap tersedia untuk regression/import
tests, bukan persistence runtime API aktif.
