# SignalGen Desktop Frontend

Konteks dan arsitektur kanonis tersedia di
[`../../PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md).

Folder ini menjadi area kerja aplikasi desktop Electron/JavaScript.

## Isi saat ini

- `renderer/index.html`: renderer UI yang saat ini disajikan oleh FastAPI.
- `renderer/static/css`: stylesheet renderer.
- `renderer/static/js`: client REST, WebSocket, auth, dan controller UI lama.
- `public`: aset publik seperti favicon.

Frontend Electron belum di-scaffold agar teman yang mengerjakan frontend dapat
menentukan toolchain dan struktur Electron-nya. Selama masa transisi, backend
tetap menyajikan `frontend/desktop/renderer/index.html`, sehingga aplikasi lama masih dapat
dijalankan.

## Kontrak integrasi

- REST API: `http://127.0.0.1:3456/api`
- OpenAPI: `http://127.0.0.1:3456/docs`
- Socket.IO: `ws://127.0.0.1:8765`

Jangan meletakkan `SUPABASE_SECRET_KEY`, service-role key, atau isi
`backend/.env` di dalam folder frontend.
