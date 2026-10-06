# SignalGen Frontend

Frontend aktif hanya memiliki satu aplikasi:

- `web/`: target aplikasi utama — public/account, screening, Go/WASM backtesting,
  hasil, sesi/perangkat, dan jurnal.
- `../legacy/desktop/`: arsip Electron renderer/shell untuk baseline dan rollback; bukan
  deliverable installer MVP terbaru.

Gunakan satu API boundary. Target API adalah Go dan FastAPI merupakan legacy
bridge/reference selama migrasi. Jangan menyimpan secret Supabase, service-role
key, provider key, signing key, atau isi `backend/.env` di frontend/WASM.

## Mulai dari sini

Sebelum mengembangkan frontend, baca
[`../docs/PROJECT_CONTEXT.md`](../docs/PROJECT_CONTEXT.md), [`../docs/PRD.md`](../docs/PRD.md), dan
[`FRONTEND_MVP_PRD.md`](../docs/frontend/FRONTEND_MVP_PRD.md). Dokumen tersebut menetapkan target;
kode/OpenAPI runtime menetapkan apa yang sudah tersedia.

Backend Docker default menjalankan Go API pada port 8080. Python hanya berjalan
melalui profile `legacy` yang dipilih eksplisit. Web memakai Vite saat development.
