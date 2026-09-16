# SignalGen Frontend

Frontend saat ini memiliki dua aplikasi yang dipertahankan selama migrasi:

- `web/`: target aplikasi utama — public/account, screening, Go/WASM backtesting,
  hasil, sesi/perangkat, dan jurnal.
- `desktop/`: legacy Electron renderer/shell untuk baseline dan rollback; bukan
  deliverable installer MVP terbaru.

Gunakan satu API boundary. Target API adalah Go dan FastAPI merupakan legacy
bridge/reference selama migrasi. Jangan menyimpan secret Supabase, service-role
key, provider key, signing key, atau isi `backend/.env` di frontend/WASM.

## Mulai dari sini

Sebelum mengembangkan frontend, baca
[`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md), [`../PRD.md`](../PRD.md), dan
[`FRONTEND_MVP_PRD.md`](FRONTEND_MVP_PRD.md). Dokumen tersebut menetapkan target;
kode/OpenAPI runtime menetapkan apa yang sudah tersedia.

Backend Docker saat ini adalah legacy sampai Go API diimplementasikan. Frontend
web dan Electron tetap memakai toolchain JavaScript masing-masing saat development.
