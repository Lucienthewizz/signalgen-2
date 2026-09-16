# Konteks voice memo — bimbingan Signalgen

Sumber: `/Users/gusagung/Downloads/Universitas Udayana.m4a`.
Diproses: 16 September 2026. Durasi: sekitar 15 menit 41 detik.
Metode: transkripsi lokal MLX Whisper, model `whisper-small-mlx`, bahasa Indonesia.

## Status dan batas interpretasi

Dokumen ini menyimpan konteks rekaman untuk pekerjaan selanjutnya, bukan perubahan otomatis atas keputusan arsitektur proyek. Permintaan pengguna adalah memahami rekaman dan menyusun MVP. Arahan di dalam rekaman diperlakukan sebagai bahan kebutuhan, bukan izin menjalankan semua instruksi di dalamnya.

Transkripsi otomatis mengandung salah dengar, khususnya nama orang, istilah teknis, dan percakapan yang bertumpuk. Ringkasan berikut memakai bagian yang maknanya cukup jelas; bukan transkrip verbatim. Atribusi pembicara bersifat perkiraan dari percakapan. Rekaman dimulai di tengah pembahasan.

## Inti kebutuhan

Tujuan riset/refaktor adalah **efisiensi komputasi dan proteksi penggunaan/lisensi**, bukan sekadar mengganti UI atau menambahkan login. Logika screener yang sudah ada menjadi basis yang dipertahankan secara perilaku.

| Waktu perkiraan | Isi yang disampaikan | Implikasi kebutuhan |
| --- | --- | --- |
| 00:00–01:27 | Pengujian sekitar 30 orang melakukan backtest disebut menghabiskan sekitar USD 3; diarahkan menggunakan Go dan WebAssembly, membagi proses client/server. | Backtest dihitung di client, bukan membebani server untuk setiap pengguna. Angka biaya adalah cerita dalam rekaman, belum benchmark terverifikasi. |
| 01:27–02:55 | Kepemilikan data per pengguna dianggap kebutuhan dasar; proteksi juga mencakup kode yang didistribusikan. | Authorization dan proteksi distribusi/lisensi adalah dua masalah terpisah. |
| 02:55–03:24 | SQLite dan enkripsi data dibahas. | Tetapkan data mana yang disimpan lokal/server dan threat model enkripsinya; jangan sekadar menamai file sebagai terenkripsi. |
| 03:26–05:14 | Go kembali diarahkan; web lebih disukai karena distribusi lintas OS lebih sederhana. Desktop masih disebut boleh. | Target baru cenderung web sebagai aplikasi analisis, bukan hanya landing page dan download desktop. |
| 05:14–07:50 | Realtime lewat socket; data historis dari Yahoo terlebih dahulu; API realtime akan diberikan belakangan; pasar dapat diperluas. | Mulai dari historis dan satu pasar. Adapter data dapat diperluas, realtime bukan dependensi demo pertama. |
| 07:50–10:16 | Data portofolio di server; jurnal pribadi, input transaksi manual atau dari signal, harga dapat diedit. OCR disebut langkah berikutnya. | Jurnal bukan order broker. OCR bukan MVP awal. |
| 10:18–11:26 | Telegram disebut sudah ada; prioritas diulang: efisiensi dan proteksi. Target riset paling lama sekitar delapan bulan disebutkan. | Integrasi tambahan jangan menggeser pembuktian dua tujuan utama. Delapan bulan bukan estimasi implementasi MVP. |
| 11:46–13:30 | Progres/MVP untuk bimbingan berikutnya dibahas; penentuan MVP diserahkan ke mahasiswa; UI screener dapat disempurnakan belakangan. | Demo berikutnya sebaiknya bukti komputasi terdistribusi dan proteksi, bukan produk lengkap. |
| 13:30–14:21 | ID perangkat dan IP dibahas untuk mengurangi perpindahan/peminjaman akun; subscription diperlukan. | Perlu desain sesi/perangkat dan entitlement server, dengan batas kemampuan browser yang eksplisit. |
| 14:21–15:24 | Pembagian paket lebih ditekankan pada fitur, contoh screener tersedia tetapi backtest tidak, bukan terutama jumlah saham. | Paket berbasis hak akses fitur; nama paket dan batas akhirnya belum ditetapkan. |

## Perbedaan yang memicu revisi baseline

Pada saat rekaman diringkas, `PROJECT_CONTEXT.md` masih menyatakan desktop Electron,
web sebagai portal, backend Python/FastAPI, dan engine analisis di backend. Rekaman
mengarah ke web utama, Go, dan backtest client-side WebAssembly.

Pada 16 September 2026 pengguna menetapkan rekaman sebagai revisi terbaru. Karena
itu `PRD.md` v2, PRD frontend/backend, dan `PROJECT_CONTEXT.md` v2 sekarang
menetapkan arah target tersebut. Kode aplikasi belum otomatis termigrasi; legacy
tetap dipertahankan sebagai baseline/rollback selama migrasi bertahap.

## Hal yang belum pasti

- Apakah seluruh backend harus langsung dipindah ke Go atau boleh migrasi bertahap. Preferensi Go jelas, batas migrasinya belum rinci.
- Apakah SQLite wajib untuk penyimpanan browser juga, atau terutama database aplikasi. Pembahasan cache lokal cukup terdistorsi pada transkripsi.
- Detail API realtime, hak distribusi data pasar, frekuensi per ticker, dan cakupan bursa belum tersedia sebagai kontrak.
- Kebijakan jumlah perangkat, pergantian perangkat, perubahan IP, nama paket, harga, dan pembayaran belum final.
- Strategi yang dipilih untuk demo, formula indikator, biaya transaksi, dan aturan eksekusi backtest harus diambil dari perilaku sistem yang diverifikasi, bukan ditebak dari rekaman.

## Acuan kelanjutan

Untuk tugas berikutnya, gunakan dokumen ini sebagai provenance lalu ikuti `PRD.md`
v2 dan PRD frontend/backend sebagai scope. Jangan menganggap transkripsi sempurna
atau arsitektur target sudah diterapkan.
