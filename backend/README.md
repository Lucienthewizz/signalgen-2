# SignalGen Backend

Backend legacy SignalGen menggunakan Python, FastAPI, Supabase Auth, dan
SQLite. Migrasi target Go dikembangkan bertahap di `core`, `cmd`, dan
`internal`; backend Python tetap menjadi baseline dan jalur rollback.

## Menjalankan backend

Dari folder repository:

```bash
cp backend/.env.example backend/.env
docker compose up --build backend
```

API tersedia di `http://127.0.0.1:3456` dan dokumentasi OpenAPI di
`http://127.0.0.1:3456/docs`. Socket.IO tersedia di
`http://127.0.0.1:8765`.

## Menjalankan test

```bash
docker compose run --rm backend-test
```

Konfigurasi rahasia backend disimpan pada `backend/.env` dan tidak boleh
dimasukkan ke Git atau ke bundle frontend.

Isi nilai Supabase di `backend/.env` sebelum menjalankannya. Docker menyimpan
SQLite pada volume `signalgen-backend-data`. Untuk koneksi IBKR/TWS dari
container gunakan host `host.docker.internal`, bukan `127.0.0.1`. Container
menjalankan REST API dan Socket.IO tanpa membuka window PyWebView lama.

Virtual environment Python tidak diperlukan untuk workflow standar. Developer
boleh membuat `.venv` sendiri untuk debugging lokal, tetapi folder tersebut tidak
boleh masuk Git.

## Target Go

Core Go/WASM dapat diuji tanpa memasang Go lokal:

```bash
docker build -f backend/Go.Dockerfile --target test .
```

`internal/auth` memverifikasi bearer ke Supabase Auth menggunakan publishable
key. Package tersebut hanya menghasilkan principal (`id` dan `email`); role,
status akun, sesi aplikasi, dan entitlement tetap harus dibaca dari storage
server SignalGen. Endpoint bisnis Go belum boleh dibuka hanya berdasarkan
metadata user Supabase.

Menjalankan target Go API secara terpisah dari FastAPI legacy:

```bash
docker compose --profile go-target up --build go-api
```

Target berjalan pada `http://127.0.0.1:8080`. Endpoint yang sudah tersedia:

- `GET /health` — public health check;
- `GET /ready` — readiness SQLite dan integritas fixture untuk Docker;
- `POST /api/v1/sessions` — membuat sesi aplikasi, membutuhkan bearer Supabase;
- `GET /api/v1/account/me` — profil/status/feature grant server-side;
- `GET /api/v1/account/sessions` — daftar maksimal 100 sesi milik pengguna;
- `DELETE /api/v1/account/sessions/{id}` — mencabut sesi milik pengguna;
- `GET /api/v1/capabilities` — membutuhkan bearer dan `X-App-Session`;
- `GET /api/v1/rules` — daftar system rule read-only sesuai entitlement;
- `GET /api/v1/rules/{id}` — snapshot rule beserta hash/versi core;
- `POST /api/v1/datasets/prepare` — menyiapkan manifest fixture sesuai entitlement;
- `GET /api/v1/datasets/{id}/manifest` — metadata/checksum dataset;
- `GET /api/v1/datasets/{id}/content` — konten OHLCV sintetis terproteksi;
- `POST /api/v1/compute-grants` — receipt singkat yang mengikat sesi, dataset,
  rule, engine, dan schema sebelum eksekusi WASM;
- `DELETE /api/v1/sessions/current` — revoke sesi aktif.

Token sesi hanya dikembalikan saat dibuat. SQLite menyimpan hash token, bukan
nilai token mentah. Daftar sesi hanya mengembalikan metadata aman, status, dan
penanda sesi aktif; ID milik pengguna lain tidak dapat dibaca atau dicabut.
Endpoint bisnis lain tetap belum diimplementasikan.

Go API memakai satu koneksi SQLite bersama untuk profile, entitlement, sesi,
dan compute grant. Koneksi mengaktifkan foreign keys, WAL, serta busy timeout
5 detik; container tetap menyimpan file tersebut pada volume
`signalgen-go-data`.

Frontend web hanya dapat memanggil Go API dari origin yang dicantumkan secara
eksplisit pada `SIGNALGEN_CORS_ORIGINS` (dipisahkan koma). Contoh development:

```env
SIGNALGEN_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SIGNALGEN_MAX_ACTIVE_SESSIONS=3
```

Konfigurasi ini tidak menerima wildcard. Request browser yang diizinkan dapat
mengirim header `Authorization`, `Content-Type`, dan `X-App-Session`. Client
Electron/server-side yang tidak mengirim header `Origin` tidak terpengaruh.

Batas sesi aktif berlaku per pengguna. Pembuatan sesi pada `installation_id`
yang sama mengganti dan mencabut sesi lama secara atomik. Pembuatan sesi dari
instalasi baru setelah batas tercapai menghasilkan `409 DEVICE_LIMIT_REACHED`;
pengguna dapat mencabut sesi lama melalui endpoint daftar sesi.

Setelah pengguna login dan membuat sesi pertamanya, developer dapat memberikan
akses demo secara lokal tanpa endpoint admin publik:

Untuk instalasi baru, bootstrap operator pertama hanya dapat dijalankan satu
kali dan target harus akun aktif yang sudah pernah membuat sesi:

```bash
docker compose --profile go-target run --rm go-api \
  signalgen-admin bootstrap-operator \
  --user USER_ID_SUPABASE \
  --actor "local:nama-developer" \
  --reason "initial project operator"
```

Setelah operator pertama ada, perintah bootstrap selalu ditolak. Menambah atau
menghapus operator berikutnya belum tersedia dan tidak boleh dilakukan melalui
payload frontend maupun metadata user Supabase.

Operator yang sudah login dan memiliki app session dapat mengelola entitlement
melalui API berikut:

- `GET /api/v1/operator/grants?user_id=USER_ID`
- `POST /api/v1/operator/grants`
- `DELETE /api/v1/operator/grants/{user_id}/{feature}`
- `PATCH /api/v1/operator/accounts/{user_id}/role`

Semua route tersebut mengambil actor audit dari identitas operator yang sudah
diverifikasi. Body dari frontend tidak dapat memilih atau memalsukan actor.
Perubahan role mewajibkan alasan dan akan ditolak dengan
`409 LAST_OPERATOR_REQUIRED` jika menurunkan role operator aktif terakhir.

Grant demo lokal tetap dijalankan dengan:

```bash
docker compose --profile go-target run --rm go-api \
  signalgen-admin grant \
  --user USER_ID_SUPABASE \
  --feature screener \
  --until 2026-10-17T00:00:00Z \
  --reason "demo pembimbing" \
  --actor "operator-lokal"
```

Cabut akses dengan subcommand `revoke` dan flag `--user`, `--feature`,
`--reason`, serta `--actor`. Setiap grant/revoke lokal disimpan bersama actor,
request ID, alasan, dan kondisi sebelum/sesudah dalam transaksi yang sama.
Catatan audit bersifat append-only: database menolak update dan delete. Tool ini
tetap merupakan operator lokal sementara; endpoint operator publik dan role
guard belum tersedia.

Dataset P0 yang tersedia saat ini hanya fixture sintetis `BBCA.JK`, market
`IDX`, timeframe `1d`, dan purpose `screen`. Endpoint menolak simbol/rentang
lain serta akun tanpa grant `screener`; ini belum merupakan integrasi provider
historis production.

## Test dengan Postman

Collection, environment tanpa rahasia, urutan eksekusi, dan cara memberikan
grant lokal tersedia di [`postman/README.md`](postman/README.md). Test script
mencakup health/readiness, auth negatif, Supabase login, app session, account,
entitlement, baseline rule, dataset fixture, compute grant, dan revoke sesi.

## OpenAPI untuk frontend

[`openapi.yaml`](openapi.yaml) adalah kontrak machine-readable untuk endpoint Go
yang sudah tersedia. Route yang masih berupa rencana sengaja tidak dimasukkan.
Validasi dan pembuatan type TypeScript dapat dijalankan dari root repository:

```bash
npx --yes @redocly/cli@1.34.5 lint backend/openapi.yaml --extends=minimal
npx --yes openapi-typescript@7.9.1 backend/openapi.yaml \
  -o frontend/web/src/api/generated/signalgen-api.d.ts
```

File generated ditempatkan oleh frontend pada folder API client-nya dan tidak
boleh diedit manual. Perubahan kontrak perlu direview bersama FE dan BE.
