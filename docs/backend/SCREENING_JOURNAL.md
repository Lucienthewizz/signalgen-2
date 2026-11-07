# Jurnal khusus hasil screening

Revisi pengguna 5 November 2026, API **0.17.0**, schema `screening-journal-1`.
Menggantikan alur jurnal transaksi manual pada web aktif.

## Alur pengguna

1. Jalankan screening baru dan pilih saham yang **Match**.
2. Pilih **Add … to journal**.
3. Periksa pilihan, lalu **Save … results to journal**.
4. Lihat arsip saham, pasar/mata uang, nama rule, sinyal, interval, waktu candle,
   harga screening dan waktu evaluasi. Tampilan waktu mengikuti SGT/UTC+8 aplikasi.

Tidak ada form transaksi manual, quantity, fee, edit/hapus, tutup posisi, grafik
atau P&L pada halaman jurnal. Daftar dipaginasi 25 baris. Harga tidak dapat diedit;
arsip ini snapshot screening, bukan transaksi broker. Backtest tidak mengisi jurnal.

Catatan jurnal lama tetap tersimpan tanpa konversi atau penghapusan. UI baru
menampilkan schema snapshot screening saja. Ledger portofolio manual yang terpisah
tetap merupakan API lain; perubahan ini tidak mengonversi snapshot menjadi BUY/SELL
ledger atau melakukan order.

## Penegakan server

- Evaluator WebSocket menerbitkan `journal_receipt` hanya pada keputusan Match
  untuk candle terbaru per saham. No match/warmup historis tidak diberi receipt.
- Receipt ditandatangani HMAC-SHA256 menggunakan key acak dalam proses API, terikat
  pemilik dan app-session. Payload memuat snapshot immutable serta UUID record.
  Client hanya mengirim receipt; input manual harga, saham, quantity atau owner
  ditolak. Harga/indikator yang disimpan berasal dari payload evaluasi server.
- Model A tetap menghitung fitur pada client. Receipt membuktikan bahwa server
  mengevaluasi fitur tersebut; bukan bukti bahwa komputasi browser tidak dimodifikasi,
  sertifikasi harga provider, atau fill broker.
- Save memeriksa kembali identitas, sesi aktif, status akun dan entitlement screener.
  GET arsip tetap boleh untuk akun aktif yang hak screening-nya sudah berakhir.
- UUID yang sama dari receipt membuat retry identik idempotent. UI tidak mengirim
  ulang baris yang sudah berhasil ketika sebagian gagal. Semua receipt tetap
  diverifikasi walaupun UUID pernah disimpan.
- Penyimpanan memakai `signalgen.user_records`, kind `journal`, melalui store dan
  RLS/FORCE RLS owner yang sudah ada. Tidak menambah schema, key `.env`, atau migration.
  Kuota 1.000 record journal per akun tetap mencakup record lama yang dipertahankan.

Receipt berlaku 24 jam, hanya pada sesi yang menerimanya dan proses API yang
menerbitkannya. Restart API atau expiry memerlukan **screening baru**. Snapshot
yang sudah tersimpan tetap dapat dibaca lintas perangkat/sesi milik akun yang sama.
History screener tersanitasi tidak menyimpan receipt; hasil history lama harus
di-screen ulang sebelum disimpan. Ini mengikuti batas proses tunggal/sticky
instance dari dataset dan ticket screener yang sudah ada, bukan dukungan cluster
receipt terdistribusi. Tidak mencatat receipt atau payload jurnal ke log.

## Endpoint

| Method | Route | Perilaku |
| --- | --- | --- |
| GET | `/api/v1/journal/screenings` | `{schema_version, items}` milik pemilik; record transaksi lama dikecualikan |
| POST | `/api/v1/journal/screenings` | Body hanya `{"receipt":"…"}`; respons record `{id,data,version,bytes}` |
| GET | `/api/v1/journal/trades[/{id}]` | Pembacaan kompatibilitas store lama; bukan route UI baru |
| PUT/DELETE | `/api/v1/journal/trades/{id}` | `410 JOURNAL_SCREENING_ONLY`; tidak mengubah data |

Semua route memerlukan bearer dan X-App-Session aktif; response privat/no-store.
Save: `400` JSON/field tak dikenal; `401/403` identitas/sesi/status/entitlement;
`422 SCREENING_RECEIPT_INVALID` → jalankan screening ulang; `409 RECORD_LIMIT` atau
conflict; `429` ikuti Retry-After; `503/504` kegagalan sementara → retry receipt yang
sama. Endpoint baru tidak menyediakan PUT/DELETE. Batas receipt 32 KiB.

## Struktur dan pemeriksaan

- `internal/journal/receipt.go`: snapshot dan penandatanganan/verifikasi.
- `internal/api/screener/websocket_handler.go`: issue receipt setelah evaluasi.
- `internal/api/journal/handler.go`: list/save khusus screening.
- `frontend/web/src/pages/workspace-journal-panel.tsx`: pilihan, simpan, daftar.
- `frontend/web/src/lib/journal-screening.ts`: gate pemilik/Match/receipt.

Tes backend meliputi tampering harga, pemilik/sesi asing, expiry/restart, no match,
penolakan mutasi manual, preservasi data lama, idempotensi, dan receipt pada hasil
WebSocket sebenarnya. Browser memakai akun/API/evaluator sintetis, bukan transaksi
akun asli: selection tanpa autosave, double click, partial failure/retry hanya gagal,
reload, pagination, outage, desktop/mobile serta dua tema. Catatan akhir pemeriksaan
berada pada [backend progress](BACKEND_PROGRESS.md).
