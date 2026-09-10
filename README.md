# SignalGen 2.0

SignalGen 2.0 adalah aplikasi screening saham, backtesting, dan pembangkit
trading signal berbasis rule teknikal. Aplikasi utama ditargetkan sebagai desktop
Electron, dengan satu backend Python/FastAPI yang juga digunakan oleh web.

Trading signal menunjukkan kondisi strategi terpenuhi. Signal bukan jaminan
keuntungan atau kepastian prediksi harga.

## Dokumen utama

- [PRD.md](./PRD.md) — kebutuhan, prioritas, acceptance criteria, dan batas fitur.
- [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — konteks dan arsitektur kanonis.
- [backend/README.md](./backend/README.md) — cara menjalankan backend dan test.
- [frontend/README.md](./frontend/README.md) — pembagian frontend web dan desktop.

Baca PRD dan project context sebelum mengubah fitur atau arsitektur utama.

## Struktur

```text
signalgen-2/
├── backend/                    Python, FastAPI, SQLite, Supabase Auth, engines
│   ├── app/
│   ├── tests/
│   ├── scripts/
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── web/                    landing, account, pricing, payment, download
│   └── desktop/                Electron dan renderer SignalGen
├── docker-compose.yml
├── PRD.md
└── PROJECT_CONTEXT.md
```

Frontend web dan desktop menggunakan backend yang sama. Docker digunakan untuk
backend; frontend akan dijalankan dengan toolchain Node.js masing-masing.

## Quick start

Prasyarat:

- Git.
- Docker Desktop atau OrbStack.
- Konfigurasi project Supabase development.

Setelah clone:

```bash
cp backend/.env.example backend/.env
```

Isi `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` pada `backend/.env`, lalu:

```bash
docker compose up --build backend
```

Layanan development:

- UI transisi: `http://127.0.0.1:3456`
- REST API: `http://127.0.0.1:3456/api`
- Swagger/OpenAPI: `http://127.0.0.1:3456/docs`
- Socket.IO: `http://127.0.0.1:8765`

Docker menjalankan backend secara headless dan tidak otomatis membuka browser
atau window Electron.

## Menjalankan test

```bash
docker compose run --rm backend-test
```

Test berjalan di container sehingga `.venv` tidak diwajibkan. Developer tetap
boleh membuat virtual environment sendiri untuk kebutuhan debugging lokal; folder
tersebut sudah diabaikan Git.

## Fitur backend saat ini

- Supabase register, login, dan current-user validation.
- Rule builder dan rule evaluation.
- Watchlist dan ticker universe.
- Scalping engine dengan IBKR dan demo mode.
- Swing screening dengan Yahoo data/cache.
- Backtesting dan riwayat hasil.
- Signal history.
- Socket.IO realtime events.
- Telegram notification.
- SQLite operational storage.

Authorization dan ownership data per-user adalah milestone backend berikutnya.
Login sudah tersedia, tetapi endpoint bisnis belum seluruhnya terisolasi untuk
setiap user.

## Development workflow

Branch utama:

- `main` — release/demo stabil.
- `dev` — integration branch.
- `feature/...` atau `refactor/...` — satu pekerjaan dengan scope kecil.

Alur perubahan:

```text
feature/refactor branch -> Pull Request -> dev -> test -> Pull Request -> main
```

Jangan commit:

- `.env` dan credential.
- Access/refresh token.
- `.venv`.
- `node_modules`.
- `__pycache__` atau `.pytest_cache`.
- Database dan log runtime.

## Legacy transition

`backend/app/main.py`, `build_exe.py`, `signalgen.spec`, dan
`signalgen_debug.spec` adalah fallback PyWebView/PyInstaller lama. File tersebut
dipertahankan sampai Electron mampu menjalankan dan mem-package backend Python
secara terverifikasi. Jangan memperluas implementasi PyWebView dengan fitur baru.

UI lama berada di `frontend/desktop/renderer/` sebagai UI transisi dan referensi
fitur. UI tersebut baru dihapus setelah pengganti Electron mencapai feature
parity dan lolos review.
