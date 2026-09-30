# Usulan MVP Signalgen berdasarkan voice memo

Status: supporting rationale. The approved scope is now `PRD.md` v2 plus the
frontend/backend PRDs; this file must not override their priorities or contract.
Implementation is not implied.
Sumber kebutuhan dan timestamp: `VOICE_MEMO_CONTEXT.md`.

## 1. Outcome yang harus dibuktikan

Pengguna membuka Signalgen melalui browser, login, mengambil dataset historis yang diizinkan, lalu menjalankan satu strategi backtest melalui Go/WebAssembly di perangkatnya. Server mengelola identitas, hak akses, data, dan jurnal transaksi; server tidak menghitung backtest pada alur client tersebut.

Keberhasilan bukan “semua fitur selesai”, melainkan ada bukti:

1. Hasil backtest setara dengan baseline yang disepakati.
2. Komputasi backtest pindah ke client dan dampak beban server diukur.
3. Akses data dan fitur berbayar dikendalikan server, dengan batas proteksi client dijelaskan secara jujur.

## 2. MVP untuk bimbingan berikutnya: satu vertical slice

Ini prioritas pertama. Jangan mulai dengan rewrite penuh atau payment gateway.

| Prioritas | Pekerjaan | Bukti selesai |
| --- | --- | --- |
| P0-1 | Tetapkan satu strategi/rule dan dataset historis kecil dengan versi tetap. Rekam hasil engine baseline. | Fixture OHLCV, parameter, trade list, dan metrik baseline tersedia; asumsi eksekusi tercatat. |
| P0-2 | Port indikator dan evaluasi rule yang diperlukan saja ke Go. | Unit test Go membandingkan output dengan fixture baseline. |
| P0-3 | Compile Go ke WebAssembly dan jalankan melalui Web Worker. | Browser menampilkan hasil; UI tetap responsif; tersedia status, error, dan pembatalan lewat penghentian worker. |
| P0-4 | Sediakan jalur data historis melalui API dengan validasi sesi dan entitlement. | Client sah mendapat data; client tanpa hak ditolak server, bukan hanya tombolnya disembunyikan. |
| P0-5 | Bandingkan baseline server-side dan client-side menggunakan dataset serta skenario sama. | Laporan latensi, CPU/RAM server dan client, transfer data, cold/warm cache, dan kegagalan. |
| P0-6 | Buat threat model singkat dan demo isolasi akses. | Pengguna A tidak dapat membaca rule/data pribadi B; akses paket tanpa backtest ditolak API terkait. |

Data statis boleh digunakan untuk membuktikan engine terlebih dahulu. Integrasi sumber historis menyusul sebelum MVP end-to-end dinyatakan selesai. Estimasi satu minggu untuk vertical slice hanyalah target kerja awal, bergantung kompleksitas engine dan akses data; bukan janji dari rekaman.

## 3. Scope MVP end-to-end

- **Web analisis:** login, pemilihan saham/periode, satu tipe strategi yang sudah tersedia, tombol run/cancel, daftar transaksi simulasi, ringkasan hasil dan error yang dapat dipahami.
- **Engine Go/WASM:** subset indikator yang cukup untuk strategi demo, evaluasi rule, trade generation, dan metrik yang sama dengan baseline. Tidak menambah logika strategi baru.
- **Data historis:** satu pasar dahulu, disarankan IDX sesuai konteks proyek. Mulai dari sumber historis yang disebut dalam rekaman, setelah akses dan hak pemakaiannya diperiksa. Dataset diberi versi, interval, zona waktu, dan metadata kualitas.
- **Akun dan isolasi:** sesi diverifikasi server; ownership rule dan jurnal dicek pada setiap akses. Integrasi auth yang ada baru dianggap dapat dipakai ulang setelah kode/kontrak diperiksa.
- **Subscription sederhana:** dua entitlement contoh, `screener` dan `backtest`. Aktivasi manual untuk demo; enforcement server. Nama paket, kuota, dan harga belum final.
- **Sesi/perangkat:** registrasi instalasi browser, batas sesi/perangkat yang dapat dikonfigurasi, daftar perangkat dan revoke. IP dicatat sebagai sinyal, bukan identitas perangkat permanen.
- **Cache terlindungi:** cache historis terkompresi dan terenkripsi saat disimpan; kunci tidak ditanam sebagai rahasia global dalam WASM. Uji kebutuhan SQLite browser terlebih dahulu. Jika belum diputuskan, demo awal cukup cache sementara, jangan mengklaim memenuhi SQLite terenkripsi.
- **Jurnal minimal di server:** input/edit/hapus transaksi beli-jual manual, tambah draft dari signal, dan ringkasan posisi/P&L dengan aturan perhitungan tercatat. Tombol “catat transaksi” tidak mengirim order ke broker.

## 4. Pembagian tanggung jawab target

```text
Browser
  UI → Web Worker → Go/WASM → hasil backtest lokal
   │        ↑
   │   dataset historis berizin / cache lokal
   ↓        ↑
API server
  sesi + ownership + entitlement + perangkat
  distribusi data historis + rule tersimpan + jurnal
  penyimpanan server + adapter sumber data
```

Target teknologi mengikuti preferensi Go dalam rekaman. Untuk mengurangi risiko, mulai dari engine Go/WASM; migrasi API server dibuat bertahap setelah kontrak saat ini dipetakan. Jika API FastAPI lama dipakai sebagai jembatan demo, nyatakan eksplisit bahwa migrasi backend Go belum selesai. Jangan menjalankan dua implementasi API yang berbeda kontrak tanpa adapter dan tes.

Build browser Go menggunakan `GOOS=js GOARCH=wasm` serta runtime JavaScript yang sesuai versi compiler. [Dokumentasi Go WebAssembly](https://go.dev/wiki/WebAssembly).

## 5. Proteksi: apa yang bisa dan tidak bisa dijanjikan

WASM bukan enkripsi kode dan bukan jaminan anti-reverse-engineering. Tool resmi ekosistem WebAssembly menyediakan disassembly; kesimpulan desainnya: modul yang dikirim ke client harus dianggap dapat dianalisis dan dimodifikasi pengguna. [WebAssembly advanced tools](https://webassembly.org/getting-started/advanced-tools/).

Implikasi:

- Lisensi tidak cukup diperiksa di frontend/WASM. Server tetap membatasi data dan layanan sesuai entitlement, menggunakan sesi yang dapat dicabut.
- Pengguna yang sudah memiliki modul dan dataset berpotensi menjalankannya kembali secara offline. Pencabutan akses server tidak dapat mengambil kembali data yang sudah diunduh. MVP tidak menjanjikan pencegahan absolut ini.
- Enkripsi cache melindungi data saat tersimpan sesuai threat model, bukan menyembunyikan plaintext dari pemilik browser saat engine memprosesnya.
- Jangan taruh service-role key, rahasia provider, atau signing key lisensi di client. Hasil backtest client juga bukan bukti tepercaya untuk otorisasi/pembayaran.
- ID instalasi browser bukan hardware ID yang tidak bisa dipalsukan. IP tetap bukan pengganti perangkat. Usulan: batas perangkat/sesi, registrasi ulang terkontrol, revoke, serta pencatatan perubahan IP; kebijakan hard-lock IP harus dikonfirmasi.
- Cache browser dapat mengevaluasi IndexedDB dan Web Crypto. API tersebut mendukung penyimpanan lokal dan penggunaan kunci di browser; tetap perlu desain manajemen kunci serta pengujian. [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto).

Jika persyaratannya adalah algoritma mustahil diperoleh pengguna, engine sepenuhnya client-side tidak memenuhi tujuan tersebut. Ini trade-off yang perlu dibawa kembali ke pembimbing, bukan ditutupi dengan istilah “secure WASM”.

## 6. Verifikasi dan acceptance criteria

### Correctness

- Dataset baseline dan WASM identik; tanpa look-ahead; warmup indikator, missing candle, timezone, adjustment harga, slippage/fee, dan urutan BUY/SELL dinyatakan.
- Trade list serta waktu sinyal cocok. Toleransi numerik ditetapkan sebelum tes, bukan dipilih setelah melihat hasil. Misalnya `abs_error <= 1e-6` bila sesuai formula/representasi; ini usulan, bukan standar final.
- Kasus minimum: data kosong, data kurang untuk indikator, parameter tidak valid, tidak ada trade, dan posisi belum ditutup di akhir periode.

### Efisiensi

- Profil proses membuktikan backtest berjalan di worker client; jalur demo tidak memanggil komputasi backtest server.
- Ulangi skenario 1, 10, dan 30 pengguna/sesi dengan dataset tetap. Pisahkan transfer data dari waktu komputasi; ukur warm cache dan cold start.
- Laporkan p50/p95 runtime, CPU/RAM, byte transfer, error rate, spesifikasi perangkat, browser, dan durasi uji. Jangan mengklaim USD 3 pasti turun ke angka tertentu tanpa pengukuran tagihan dan kondisi yang setara.
- Pembatasan ukuran dataset dan satu job per tab melindungi memori perangkat. Cancel/error tidak membuat UI hang.

### Keamanan dan akses

- Request langsung tanpa sesi atau tanpa entitlement ditolak server meskipun UI dimodifikasi.
- Akses lintas pengguna untuk rule, jurnal, dan daftar perangkat ditolak.
- Pencabutan sesi/perangkat menghentikan akses server berikutnya; tes mencatat batasan hasil/cache offline yang sudah tersedia.
- Cache yang diklaim terenkripsi tidak menyimpan plaintext persisten; kunci global tidak dibundel dalam aplikasi.
- Akun dengan hak screener saja tetap dapat memakai screener tetapi tidak memperoleh akses data/layanan backtest yang dilindungi. Pengguna dapat menghitung sendiri dari data lain; ini bukan kemampuan yang dapat dilarang secara absolut oleh aplikasi.

## 7. Di luar MVP awal

- Realtime production dan API market yang belum diberikan. Jika perlu demo socket, gunakan replay berlabel simulasi, bukan klaim live.
- Semua bursa internasional sekaligus; desain adapter cukup extensible.
- OCR screenshot transaksi, integrasi broker, dan auto-execution.
- Payment gateway, billing otomatis, email marketing, banyak paket/kuota.
- Rewrite seluruh engine/indikator dan desain ulang UI lengkap.
- Distribusi installer Electron untuk banyak OS sebagai jalur utama.
- Penambahan Telegram baru sebelum core lolos; status fitur lama perlu diverifikasi.

## 8. Urutan pekerjaan dan pembagian tim yang disarankan

1. **Kesepakatan arsitektur dan baseline:** pilih fixture/strategi; dokumentasikan perubahan target web/Go/WASM. Petakan kode memakai graph/coverage sesuai instruksi proyek ketika implementasi dimulai.
2. **Core dan WASM:** port subset engine, buat tes parity, lalu worker integration.
3. **API dan akses:** kontrak dataset, auth, entitlement, ownership, serta sesi/perangkat.
4. **Flow web dan cache:** run/cancel/result, error handling, cache dengan threat model yang teruji.
5. **Jurnal server:** transaksi manual dan draft signal, tanpa broker execution.
6. **Evaluasi riset:** benchmark, tes keamanan, tabel temuan dan keterbatasan; baru perluas fitur.

Backend/core menangani engine Go, API, data, authorization dan baseline correctness. Frontend menangani flow web, worker bridge, cache integration, hasil dan jurnal UI. Keduanya menyepakati schema input/output sebelum bekerja. Ini pembagian tanggung jawab manusia yang diusulkan, bukan dispatch agent atau perubahan kode yang telah dijalankan.

## 9. Paket hasil untuk bimbingan

- Demo satu strategi melalui browser.
- Diagram client/server dan alasan memilih Go/WASM.
- Fixture serta laporan parity hasil dengan baseline.
- Benchmark efisiensi dengan kondisi uji yang tercatat.
- Demo entitlement/ownership dan threat model proteksi.
- Daftar batasan, keputusan yang perlu dikonfirmasi, dan backlog berikutnya.

Definisi selesai MVP: alur end-to-end teruji, bukan hanya modul WASM berhasil di-load atau landing page selesai dibuat.
