# SignalGen Desktop Frontend

Konteks dan arsitektur kanonis tersedia di
[`../../PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md).

Folder ini menjadi area kerja aplikasi desktop Electron/JavaScript.

## Aplikasi Electron baru

Frontend Electron menggunakan React, TypeScript, dan Vite. Renderer baru berada
di `src/`; renderer lama tetap dipertahankan di `renderer/` sampai seluruh fitur
mencapai parity.

## Update implementasi

- Desktop shell Electron dengan `contextIsolation`, sandbox, dan preload terbatas.
- UI autentikasi untuk login dan registrasi melalui REST API.
- Dashboard responsif dengan status koneksi backend dan navigasi workspace.
- Halaman placeholder untuk Rule Builder, Watchlist, Stock Screening,
  Backtesting, Realtime Signal, dan Settings.
- API client terpusat dengan Bearer token, penanganan `401`, dan session storage.
- Proxy development untuk FastAPI dan Socket.IO agar renderer dapat dijalankan
  dari browser maupun jendela Electron.
- Build production TypeScript/Vite yang dapat dimuat dari desktop shell.

Data statistik dan market watch pada preview dashboard masih berupa data contoh
dan diberi label sebagai preview. Autentikasi serta status backend sudah memakai
endpoint backend sebenarnya.

## Menjalankan aplikasi

Pastikan backend Docker sudah berjalan sebelum membuka frontend:

```bash
cd ../../backend
docker compose up -d
```

Kemudian jalankan frontend dari folder ini:

```bash
npm install
npm run dev          # preview web di http://127.0.0.1:5173
npm run electron:dev # Vite dan Electron bersamaan
npm run build
```

Vite mem-proxy `/api` ke FastAPI port `3456` dan `/socket.io` ke port `8765`.
Port `8765` bukan halaman web dan akan menampilkan Not Found jika dibuka langsung.

## Renderer legacy

- `renderer/index.html`: renderer UI yang saat ini disajikan oleh FastAPI.
- `renderer/static/css`: stylesheet renderer.
- `renderer/static/js`: client REST, WebSocket, auth, dan controller UI lama.
- `public`: aset publik seperti favicon.

Selama masa transisi, backend tetap menyajikan
`frontend/desktop/renderer/index.html`, sehingga aplikasi lama masih dapat
dijalankan tanpa mengganggu renderer Electron yang baru.

## Kontrak integrasi

- REST API: `http://127.0.0.1:3456/api`
- OpenAPI: `http://127.0.0.1:3456/docs`
- Socket.IO: `ws://127.0.0.1:8765`

Jangan meletakkan `SUPABASE_SECRET_KEY`, service-role key, atau isi
`backend/.env` di dalam folder frontend.
