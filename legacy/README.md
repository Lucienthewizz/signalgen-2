# Legacy pembanding SignalGen

Folder ini **bukan produk aktif**. Source Python/FastAPI/SQLite, test, renderer
Electron, dan konfigurasi installer dipertahankan untuk perbandingan dengan
Go/WASM. Pemindahan folder tidak menghapus atau memigrasikan database lama.

```text
legacy/
├── python/    app, tests, scripts, dependencies, Dockerfile, PyInstaller
└── desktop/   Electron shell, React renderer dan renderer lama
```

Backend aktif tetap `backend/` (Go/Gin/Postgres); frontend aktif `frontend/web/`.
Schema Postgres `legacy` berbeda dari folder ini: schema itu mengarsipkan data,
sedangkan folder ini menyimpan source dan alat pengujian.

## Menjalankan pembanding

Dari root repository, setelah `backend/.env` tersedia:

```bash
docker compose --profile legacy up --build -d backend
docker compose --profile legacy-test run --build --rm backend-test
```

Legacy HTTP: `http://127.0.0.1:3456`; Socket.IO: port `8765`.
Go aktif tetap port `8080`, dengan raw WebSocket (bukan Socket.IO).
Volume `signalgen-backend-data` dan lokasinya di container sengaja tetap sama.
Jangan gunakan `docker compose down -v` jika data lama masih dibutuhkan.

```bash
cd legacy/desktop
npm ci
npm run electron:dev
```

Untuk baseline indikator offline, jalankan `scripts/export_m0_baseline.py`
dari `legacy/python` dengan dependencies Python legacy. Script membaca fixture
yang sama di `backend/core/testdata/default_scalping_v1.json`, tidak menulisnya.
Hasil baseline dibekukan untuk correctness; waktu compute/network perlu diukur
terpisah untuk membandingkan efisiensi, bukan sekadar melihat output sama.

Installer lama berada di `legacy/python/build_exe.py` beserta dua file `.spec`.
Pemindahan ini tidak menjamin installer lintas OS; pengemasan Windows belum
diuji ulang. Konfigurasi rahasia tetap di `backend/.env`, tidak disalin ke sini.
