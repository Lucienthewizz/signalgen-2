# Katalog IDX dan UI — 14 Oktober 2026

## Cakupan

Slice ini menambahkan **metadata katalog**, bukan mengubah scope menjadi realtime
atau men-screen seluruh IDX dalam satu request. Sumber adalah ekspor resmi IDX
yang sama dengan koleksi historis sebelumnya. Harga tetap berasal dari Yahoo.

| Angka | Arti |
| --- | --- |
| 962 | Kode saham dalam snapshot katalog IDX yang diimpor |
| 921 / 41 | Riwayat berhasil / Yahoo HTTP 404 pada koleksi sebelumnya |
| 3 | Maksimum anggota satu universe/screening request saat ini |
| 5 | Sesi aplikasi per akun pada override testing lokal, bukan jumlah saham |

Metadata yang tersedia di katalog tidak menjamin OHLCV tersedia di Yahoo atau
arsip. HTTP 404 tidak digunakan untuk menandai saham delisting. Saham yang gagal
diambil tetap dilaporkan oleh koleksi; reader tidak mengubah kegagalan menjadi
hasil no-match. Aturan ownership, app session dan entitlement tetap berlaku.

## Impor yang aman dan repeatable

Tool `backend/cmd/importidx` membaca XLSX/CSV melalui importer katalog yang sudah
memvalidasi kode, tanggal, duplikasi dan hash file sumber. Dry-run adalah default:

```sh
# Dari backend. Tidak membuka database atau membaca kredensial.
go run ./cmd/importidx -catalog "/path/Daftar Saham.xlsx"

# Admin/migration connection disediakan melalui environment privat.
# Tidak ada fallback ke SUPABASE_DB_URL milik HTTP runtime.
go run ./cmd/importidx -catalog "/path/Daftar Saham.xlsx" -apply
```

`-apply` membutuhkan `SUPABASE_ADMIN_DB_URL`. Tool menjalankan satu INSERT bulk
parameterized dengan `ON CONFLICT(symbol) DO NOTHING`: tambah-saja, atomik,
tanpa rename/reactivate/delete record lama. Jangan menggunakan hak tulis katalog
untuk role API runtime. Tidak ada endpoint impor publik atau Data API exposure.

Tidak diperlukan migration schema baru karena `signalgen.stock_catalog` sudah
ada. Pada project cloud SignalGen (`igbccuajdetydwxtwwhu`), run pertama menambahkan
959 record dan mempertahankan 3 seed. Query sesudahnya membuktikan 962 record aktif
dan 962 provider symbols unik. Run kedua menambahkan 0 dan mempertahankan 962.
RLS tetap aktif; policy SELECT untuk authenticated/runtime tetap tersedia.
Ini bukan perubahan akun, role, grant, rules atau OHLCV cloud.

Provenance file sumber: SHA-256
`eb704c75b4d5eb694092baad819c37e7a24ef83f5dd46469a5776f1a6d474955`.
File sumber dan snapshot harga tetap lokal di luar Git, bukan isi migration.

## Perubahan aplikasi

- `internal/universe/catalog_import.go`: bulk insert terpisah dari route/repository
  pengguna; validasi dan SQL tidak disisipkan ke `app/main`.
- `cmd/importidx`: validasi, dry-run dan apply administratif.
- `GET /api/v1/stocks`: route lama sudah membaca seluruh record aktif; response
  `{items:[...]}` tidak berubah dan tetap memerlukan bearer + app session.
- OpenAPI dan TypeScript tidak lagi mengunci simbol pada BBCA/BBRI/TLKM. Validasi
  katalog/keanggotaan sebenarnya tetap dilakukan backend, bukan tipe frontend.
- `StockCatalogPicker`: pencarian kode/nama, 12 hasil per halaman, pilihan tetap
  terlihat saat pencarian/halaman berubah, deselect, loading/empty dan keyboard.
  Identitas/tipografi/tokens UI lama dipertahankan; tidak ada redesign halaman.

Kode besar tidak berarti render 962 tombol sekaligus. UI mencari pada metadata
yang telah dimuat, tetapi hanya menampilkan halaman kecil. Data OHLCV besar tidak
dimasukkan ke state komponen ini. Katalog bukan bukti performa screening 962 saham.

## Verifikasi

Tes importer/batas/credential isolation, frontend search/pagination, typecheck,
build, dan suite backend race dijalankan. UI fixture browser memakai **data
sintetis berlabel jelas**, bukan pengganti hasil API/akun asli. Interaksi browser
memeriksa pagination, pemilihan/deselection, loading/empty, 1440/390px, dua tema,
dan tidak ada horizontal page overflow. Screenshot berada di output/playwright
lokal yang diabaikan Git.

Untuk mengulang tes UI fixture (Vite port 5175 berjalan), gunakan sesi CLI
Playwright terpisah dan jalankan `tests/browser/stock-catalog.cli.js` dengan
`run-code`. Fixture HTML bukan entry production build dan tidak memakai auth/API.
Tes fixture tidak membuktikan login, ownership atau screening cloud end-to-end.

Pengujian akun asli kemudian berhasil melalui UI lokal 5175 → Go API 8080 →
Supabase cloud dan request Yahoo (mode default, bukan reader arsip). Setelah
pengguna login sendiri, katalog menampilkan 962 saham. Satu universe uji baru
`Uji katalog IDX — ASII ANTM INDF` berhasil disimpan; universe demo lama tetap
utuh. Screening dengan rule pengguna `RSI14 < 30` selesai: ASII/ANTM/INDF masing-
masing tidak memenuhi, RSI yang tampil 47.74/45.79/51.56. Candle terakhir yang
ditampilkan 13 Oktober 2026 dan UI menyatakan bukan harga live. Ini bukti jalur
katalog → owner universe → Yahoo/dataset → WASM → private scoring → hasil UI
untuk tiga saham terpilih, bukan benchmark/coverage seluruh 962 saham.

## Tahap berikutnya

Batas 3 tetap dikunci pada validation Go, API/OpenAPI, dan constraint posisi
database (0..2). Menaikkannya memerlukan migration/batas yang konsisten, batching,
warmup/ukuran dataset, grants/tickets, worker/socket bounds dan benchmark. Jangan
hanya mengubah angka di UI. Multi-bursa, pembaruan harian/incremental, data-client
ciphertext dan benchmark CPU/RAM kedua sisi tetap merupakan pekerjaan terpisah.

Tidak ada klaim bahwa semua empat tahap roadmap selesai pada slice katalog ini.
