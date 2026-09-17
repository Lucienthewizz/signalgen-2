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
