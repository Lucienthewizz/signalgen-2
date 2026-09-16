# SignalGen Backend

Backend SignalGen menggunakan Python, FastAPI, Supabase Auth, dan SQLite.

## Menjalankan backend

Dari folder repository:

```bash
cd backend
../.venv/bin/python -m app.main
```

API tersedia di `http://127.0.0.1:3456` dan dokumentasi OpenAPI di
`http://127.0.0.1:3456/docs`. Socket.IO tersedia di
`http://127.0.0.1:8765`.

## Menjalankan test

```bash
cd backend
../.venv/bin/python -m pytest
```

Konfigurasi rahasia backend disimpan pada `backend/.env` dan tidak boleh
dimasukkan ke Git atau ke bundle frontend.

Set `PASSWORD_RESET_REDIRECT_URL` ke URL halaman reset web yang sudah masuk
allowlist Redirect URLs di Supabase. Nilai development bawaan adalah
`http://127.0.0.1:5174/?view=reset-password`.
Untuk deployment dengan origin web terpisah, isi daftar origin eksplisit pada
`CORS_ALLOWED_ORIGINS` (dipisahkan koma); jangan gunakan wildcard bersama
credential.

## Menjalankan dengan Docker

Dari folder repository:

```bash
cp backend/.env.example backend/.env
docker compose up --build backend
```

Isi nilai Supabase di `backend/.env` sebelum menjalankannya. Docker menyimpan
SQLite pada volume `signalgen-backend-data`. Untuk koneksi IBKR/TWS dari
container gunakan host `host.docker.internal`, bukan `127.0.0.1`. Container
menjalankan REST API dan Socket.IO tanpa membuka window PyWebView lama.
