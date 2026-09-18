# Postman test — SignalGen Go API

File ini menguji kontrak API yang **sudah diimplementasikan**, bukan seluruh
route rencana pada `MVP_API_CONTRACT.md`.

## 1. Jalankan Go API

Pastikan `backend/.env` berisi `SUPABASE_URL` dan
`SUPABASE_PUBLISHABLE_KEY`, lalu dari root repository jalankan:

```bash
docker compose --profile go-target up --build -d go-api
docker compose --profile go-target ps
```

Container harus berstatus `healthy` dan API tersedia pada
`http://127.0.0.1:8080`.

## 2. Import ke Postman

Import dua file berikut:

1. `SignalGen-Go-API.postman_collection.json`
2. `SignalGen-Local.postman_environment.json`

Pilih environment **SignalGen Local**, kemudian isi hanya di Postman:

- `supabase_url`
- `supabase_publishable_key`
- `email`
- `password`

Jangan commit/export environment yang sudah berisi password atau token.
Jika sudah memiliki access token, `access_token` dapat diisi manual dan folder
`02 Supabase login` dilewati.

## 3. Urutan menjalankan test

Jalankan folder secara berurutan:

1. `00 Public health`
2. `01 Authorization negative checks`
3. `02 Supabase login`
4. `03 App session and account`
5. `04 Expected entitlement denial`

Folder 04 memang harus menghasilkan `403 ENTITLEMENT_REQUIRED`. Ini membuktikan
authorization aktif, bukan menandakan API rusak.

Setelah request **Current account**, environment otomatis memiliki `user_id`.
Berikan akses demo dari terminal dengan mengganti `USER_ID` memakai nilai itu:

```bash
docker compose --profile go-target exec go-api \
  signalgen-admin grant \
  --user USER_ID \
  --feature screener \
  --until 2026-10-18T00:00:00Z \
  --reason "postman local test" \
  --actor "postman-local"
```

Kemudian jalankan:

6. `05 Authorized screening fixture`
7. `06 Logout - run last`

Folder 05 menyimpan dataset ID, checksum, versi, dan compute grant ke environment.
Folder 06 mencabut sesi saat ini, lalu memastikan token sesi tersebut langsung
ditolak. Untuk mengulang pengujian, jalankan kembali **Create app session**.

## Yang diverifikasi

- liveness dan readiness Docker;
- request tanpa bearer ditolak;
- login Supabase menghasilkan access token;
- app-session dibuat dan token mentah tidak muncul dalam metadata;
- profil, entitlement, dan sesi hanya dibaca untuk pemiliknya;
- baseline rule read-only cocok dengan hash/versi core;
- dataset ditolak sebelum grant dan tersedia setelah grant;
- manifest/checksum/konten fixture `BBCA.JK` konsisten;
- compute grant terikat pada dataset, rule, engine, dan schema;
- revoke sesi berlaku pada request berikutnya.
