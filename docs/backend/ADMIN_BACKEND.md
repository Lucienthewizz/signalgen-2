# Backend admin SignalGen

Admin disebut **operator** dalam kontrak dan database. Ini kelanjutan backend
yang diminta pengguna, bukan perubahan fokus menjadi desktop atau klaim semua
fitur admin P2 sudah selesai. UI admin dasar tersedia di `#app/admin`;
pada 26 Oktober 2026 ditambahkan pencarian email, pemilihan pengguna dan preset
durasi akses. [Panduan pemberian akses](../../frontend/web/README.md#admin-access-management-26-october-2026).

## Yang bisa digunakan

| Operasi | Endpoint |
|---|---|
| Daftar akun aplikasi | `GET /api/v1/operator/accounts` |
| Suspend / aktifkan kembali | `PATCH /api/v1/operator/accounts/{user_id}/status` |
| Riwayat audit satu akun | `GET /api/v1/operator/audit-events?user_id={user_id}` |
| Grant fitur yang sudah ada | `GET/POST /api/v1/operator/grants` |
| Cabut grant yang sudah ada | `DELETE /api/v1/operator/grants/{user_id}/{feature}` |
| Ubah role yang sudah ada | `PATCH /api/v1/operator/accounts/{user_id}/role` |
| Aktivasi subscription MVP yang sudah ada | `POST /api/v1/operator/subscriptions` |

Semua memakai Gin, bearer Supabase yang diverifikasi, `X-App-Session` aktif,
akun aktif dan role `operator` dari database. Role bukan dari JSON atau
`user_metadata`. Pengecualian WebSocket screening tetap seperti arsitektur lama.
Tidak ada endpoint publik untuk menjadikan diri sendiri admin.

Daftar akun adalah `signalgen.account_profiles`, bukan semua identitas
`auth.users`. Akun yang belum memiliki profil aplikasi tidak muncul. Email pada
daftar merupakan snapshot email yang diketahui aplikasi; endpoint ini tidak
mengubah email/password Supabase. Operator tidak memperoleh akses ke rule,
dataset, jurnal atau bio privat pengguna lain hanya karena memiliki role ini.

## Cara daftar dan pagination bekerja

Contoh URL lengkap untuk backend Docker lokal:

```text
GET http://127.0.0.1:8080/api/v1/operator/accounts?limit=25&role=user&status=active
```

Respons `items` berisi `user_id`, `email`, `role`, `status`, `created_at` dan
`updated_at`. `next_cursor` hanya muncul jika masih ada halaman berikutnya.
Gunakan nilainya sebagai `after`; urutan naik berdasarkan UUID, bukan nama atau
waktu daftar. `limit` default 25, maksimum 100. Filter `role`/`status` opsional.
Filter `q` opsional mencari substring email profil atau UUID tanpa membedakan
huruf besar/kecil, maksimal 200 karakter setelah trim. `%` dan `_` diperlakukan
sebagai teks literal, bukan wildcard. Search/filter diterapkan sebelum pagination;
ubah pencarian dengan cursor awal, bukan meneruskan cursor pencarian sebelumnya.
Parameter kosong, berulang, tak dikenal, atau cursor bukan UUID ditolak 422.

Audit wajib menyebut target `user_id`. Urutan turun berdasarkan ID; kirim
`next_cursor` sebagai `before` untuk halaman berikutnya. ID/cursor audit adalah
**string angka**, jangan dikonversi ke JavaScript `Number`. Response tidak
menyertakan JSON before/after yang tersimpan, token, hash sesi atau payload bisnis.
Pagination bukan snapshot permanen lintas request; data dapat berubah ketika
operator lain bekerja. Semua respons memakai `private, no-store`.

## Apa yang terjadi ketika suspend

1. Operator diperiksa ulang dari database di dalam transaksi.
2. Status terakhir dibandingkan dengan `expected_status` dari form admin.
3. Jika target operator, backend memastikan operator aktif lain masih ada.
4. Status berubah dan semua sesi aplikasi target dicabut.
5. Audit perubahan ditambahkan; hanya kemudian transaksi commit.

Jika audit/revokasi gagal, seluruh perubahan rollback. Suspend memakai lock yang
sama dengan perubahan role dan pembuatan sesi. Ini mencegah dua operator saling
menonaktifkan sampai tidak tersisa operator aktif, atau sesi baru lolos ketika
suspend sedang berjalan. Pembuatan sesi juga memeriksa status di dalam transaksi.

Rules, grants, subscription dan data pengguna **tidak dihapus**. Supabase Auth
tidak diban/dihapus; bearer/refresh token identitas tidak dicabut oleh operasi
ini. Login dapat tetap memverifikasi identitas, tetapi akun suspended tidak bisa
membuat sesi atau menjalankan fitur aplikasi. Mengaktifkan kembali akun tidak
menghidupkan sesi lama: frontend harus membuat sesi baru. App-session ini
berbeda dari sesi identitas Supabase.

Ticket screening yang terikat pada sesi lama gagal pada upgrade/recheck.
Pekerjaan yang sudah lolos recheck dan sedang dievaluasi tidak dibatalkan secara
retroaktif; suspend berlaku pada pemeriksaan izin berikutnya. Ini bukan mekanisme
force-disconnect seluruh koneksi secara instan di banyak replica.

`expected_status` menolak form yang status terakhirnya tidak cocok (`409
STATUS_CONFLICT`); ini bukan nomor versi global dan tidak mendeteksi siklus
active → suspended → active di antara dua pembacaan. Update ke status yang sama
merupakan no-op setelah pemeriksaan expected status, tanpa audit palsu baru.

## Test manual di Postman

Gunakan **akun test**, bukan akun teman/production. Isi token secara privat dan
jangan kirim/export token, password atau `.env` dalam laporan.

Import `backend/postman/SignalGen-Admin.postman_collection.json`. Collection ini
read-only; tidak ada suspend otomatis saat menjalankan collection. Isi:

- `base_url`: `http://127.0.0.1:8080`
- `operator_access_token`: bearer dari login operator yang sudah sah
- `operator_app_session`: secret sesi aplikasi operator
- `target_user_id`: UUID akun test yang sudah memiliki profil aplikasi

Operator pertama tetap dibuat melalui CLI bootstrap yang sudah ada, secara
out-of-band dan sekali saja. Tidak ada bootstrap akun nyata yang dijalankan
sebagai bagian pengembangan ini. Lihat bagian operator pada `backend/README.md`.

Urutan uji manual:

1. Jalankan daftar tanpa token: 401 `AUTH_REQUIRED`.
2. Dengan akun biasa dan sesi valid: 403 `ROLE_REQUIRED`.
3. Dengan operator: daftar dan audit 200. Salin UUID target dari daftar.
4. Buat request baru berikut; **jangan pilih operator terakhir** sebagai target.

```text
PATCH http://127.0.0.1:8080/api/v1/operator/accounts/{UUID-akun-test}/status
Authorization: Bearer {token-operator}
X-App-Session: {sesi-operator}
Content-Type: application/json
```

```json
{"status":"suspended","expected_status":"active","reason":"Uji moderasi pada akun test"}
```

Harapkan 200, akun berstatus suspended, sesi target lama ditolak, dan audit
`account.status_changed` muncul. Untuk mengaktifkan kembali:

```json
{"status":"active","expected_status":"suspended","reason":"Uji selesai"}
```

Harapkan 200; buat sesi baru target, karena sesi lama tetap revoked. Form stale
menghasilkan 409 `STATUS_CONFLICT`, penonaktifan operator terakhir 409
`LAST_OPERATOR_REQUIRED`, UUID/reason tidak valid 422, field actor/user_id
tambahan 400, rate-limit mutation 429. Error dependency menghasilkan 503 dengan
pesan aman, bukan detail SQL. Reason wajib 1–500 karakter setelah trim, tanpa
control character; jangan masukkan kredensial ke reason.

## File yang perlu dibaca

- `internal/account/management.go`: model metadata, kontrak dan validasi.
- `internal/account/management_repository.go`: query, transaksi dan audit.
- `internal/api/operator/accounts.go`: adapter Gin/HTTP dan pemetaan error.
- `internal/operator/routes.go`: daftar route admin.
- `internal/session/repository.go`: recheck status dalam pembuatan sesi.
- `internal/api/tests/operator_management_test.go`: contract/security test.
- `internal/api/tests/operator_postgres_test.go`: transaksi/race/rollback nyata.

Migration `20261006053327_operator_account_status.sql` menambah action pada
constraint audit dan index `(target_user_id, id desc)`, tanpa tabel baru atau
perubahan RLS/exposure Data API. **Sudah diterapkan ke Supabase cloud signalgen-2
pada 6 Oktober 2026.** Dry-run hanya menemukan migration ini; sesudah deployment,
ketujuh migration lokal cocok dengan riwayat cloud. Constraint audit tervalidasi,
index valid/ready, RLS tetap aktif, dan client roles tidak mendapat akses audit.
Jumlah profil, sesi, rules dan audit sebelum/sesudah tidak berubah. Deployment
schema ini tidak menguji suspend/reactivation terhadap akun cloud nyata dan tidak
menggantikan deployment image backend terbaru. Security advisors tidak menemukan
kategori baru; peringatan lama fungsi public dan proteksi password masih ada.
Database/container uji lokal tidak menggantikan database kamu.

Belum termasuk UI suspend/audit penuh, penghapusan akun, perubahan password oleh operator,
payment/webhook, refund, daftar subscription semua user, metrics dashboard,
mass actions atau pengiriman email. Bootstrap production/least-privilege DB role
dan validasi dengan akun operator nyata tetap perlu proses deployment terpisah.

## Bukti verifikasi lokal — 6 Oktober 2026

Seluruh test Go dengan race detector, Postgres/WASM/WebSocket dan Go vet lolos.
Schema runner lolos 7 migration dan 2 pemeriksaan policy. Test admin memeriksa
pagination, actor/role/sesi palsu atau dicabut, rollback ketika audit gagal,
reactivation, dua belas request pembuatan sesi yang berlomba dengan suspend,
serta perubahan role/status bersamaan yang mempertahankan operator terakhir.

OpenAPI tervalidasi; Postman read-only lolos pemeriksaan JSON/script tanpa token
terisi. Runtime Docker terbaru healthy, `/health` dan `/ready` 200; semua endpoint
admin tanpa login 401. Log runtime tidak membocorkan UUID/reason canary dan
shutdown SIGTERM exit 0. Ini bukti lokal dengan fixture terisolasi, bukan login
operator nyata atau validasi cloud/UI production. Perubahan belum commit/push.
