# SignalGen Frontend

Frontend dibagi menjadi tepat dua aplikasi:

- `web/`: landing page, pricing, akun, dan pembayaran.
- `desktop/`: Electron renderer dan desktop shell untuk fitur SignalGen.

Keduanya menggunakan backend API yang sama. Jangan menyimpan secret Supabase,
service-role key, atau isi `backend/.env` di dalam frontend.

## Mulai dari sini

Sebelum mengembangkan frontend, baca
[`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). Dokumen tersebut adalah satu
sumber kebenaran konteks, arsitektur, fitur, integrasi, dan aturan kerja proyek.

Backend dijalankan dengan Docker dari root repository. Frontend web dan Electron
tetap dijalankan dengan toolchain JavaScript masing-masing selama development.
