# Pengumpulan historis IDX — 14 Oktober 2026

Tahap ini menyiapkan koleksi penelitian, bukan mengganti Model A atau membuktikan
seluruh screener sudah mendukung semua saham. Tidak ada migration cloud, perubahan
rule/izin pengguna, Redis, endpoint publik baru, atau browser cache pada slice ini.

## Cakupan dan sumber

- Katalog: ekspor resmi halaman [Daftar Saham IDX](https://www.idx.co.id/id/data-pasar/data-saham/daftar-saham/).
- Pengunduhan melalui halaman biasa tersedia; akses HTTP otomatis dari lingkungan
  ini mendapat 403. Jangan menembus pembatasan atau mengganti dengan daftar tebakan.
- Ekspor yang diterima mencakup 962 ticker unik; jumlah itu adalah snapshot sumber,
  bukan konstanta permanen. IPO/delisting berikutnya mengubah cakupan.
- Harga: endpoint chart publik Yahoo Finance yang dipakai adapter Go. Ini sumber
  unofficial MVP, bukan feed realtime berlisensi atau jaminan redistribusi.
- Interval: `1d`. Usulan rentang pertama satu tahun, bukan ketentuan tanggal Prof.
- Run tanggal ini: `[2025-10-14, 2026-10-14)` dalam Asia/Jakarta. Artinya batas awal
  inklusif dan tanggal 14 Oktober 2026 tidak ikut dimasukkan.

Jumlah ticker katalog berbeda dari jumlah ticker yang berhasil mendapat OHLCV.
Jumlah candle juga tidak harus sama: IPO baru, suspensi, data null atau keterbatasan
provider harus tetap dilaporkan. Jangan menyebut data complete hanya karena HTTP 200.

## Struktur kode

```text
backend/cmd/collectidx/                 CLI, parameter tanggal dan lifecycle proses
backend/internal/collection/catalog.go Import ekspor XLSX/CSV dan provenance
backend/internal/collection/runner.go  Job sequential, file/report dan resume
backend/internal/marketdata/history.go Adapter Yahoo dengan rentang tanggal eksplisit
backend/data/                         Output default lokal, diabaikan Git
```

Pekerjaan bulk dipisahkan dari API supaya tidak mengambil seluruh IDX setiap Run.
Limit tiga anggota universe UI tidak dinaikkan. Riwayat koleksi memakai `period1`
dan `period2`, tidak dipangkas ke 100 candle seperti dataset screening saat ini.

## Menjalankan

Dari folder `backend`, dengan Go yang sesuai `go.mod`:

```sh
# Validasi file saja: tidak meminta harga atau mengubah database.
go run ./cmd/collectidx -catalog "/path/Daftar Saham.xlsx" -validate-only

# Smoke test: maksimal lima request baru. Pending tetap tercatat, exit 1 wajar.
go run ./cmd/collectidx -catalog "/path/Daftar Saham.xlsx" \
  -as-of 2026-10-14 -out data/idx/2026-10-14 -limit 5

# Lanjutkan seluruh katalog, melewati success yang file/checksumnya masih valid.
go run ./cmd/collectidx -catalog "/path/Daftar Saham.xlsx" \
  -as-of 2026-10-14 -out data/idx/2026-10-14

# Sesudah provider pulih, ulangi ticker yang sebelumnya gagal secara eksplisit.
go run ./cmd/collectidx -catalog "/path/Daftar Saham.xlsx" \
  -as-of 2026-10-14 -out data/idx/2026-10-14 -retry-failed
```

`-from YYYY-MM-DD` mengatur awal lain. `-as-of` adalah batas akhir **eksklusif**,
bukan tanggal yang pasti tersedia di provider. Default cutoff konservatif hanya
mengizinkan hari berjalan setelah 18:00 WIB. Ini buffer waktu, belum layanan
kalender bursa atau verifikasi status auction. Timestamp disimpan sebagai UTC;
jangan menafsirkan offset UTC sebagai harga dari sesi lain.

Job memakai satu worker dan default jeda satu detik antar instrumen. Jeda minimum
500 ms bukan janji rate limit Yahoo. HTTP 429 menghentikan batch. Tiga kegagalan
sementara berturut-turut juga menghentikannya. Provider retry tetap dibatasi dan
Retry-After panjang tidak diabaikan. Tidak ada loop pengunduhan tanpa batas.

`Ctrl+C` menghentikan proses. Report disimpan setelah setiap ticker. Jangan
menjalankan dua proses pada output yang sama; `.collect.lock` mencegahnya. Jika
proses di-kill paksa, pastikan sudah berhenti sebelum menghapus **file lock itu
saja**. Catalog atau window berbeda harus memakai output directory baru.

## Format input

Reader menerima worksheet pertama dari ekspor IDX `.xlsx` yang plain. Formula,
kode tidak valid, duplicate, atau tanggal yang tidak dapat dibaca ditolak.
Format XLS/XLSM dan spreadsheet generik tidak didukung. Alternatif CSV UTF-8
dipisahkan koma, dengan header:

```text
kode_idx,nama_perusahaan,tanggal_pencatatan
```

Tanggal dapat berupa ISO `YYYY-MM-DD` atau tanggal singkat pada ekspor IDX.
File asli tidak diubah. Metadata katalog memuat source URL, timestamp import,
SHA-256 file asli dan daftar ticker. Mapping `KODE.JK` masih memerlukan verifikasi
ketersediaan pada Yahoo, yang hasilnya terlihat sebagai success/failed per ticker.

## Hasil dan arti keamanan

```text
catalog.json       Daftar/provenance sumber
report.json        Seluruh ticker: pending, success atau failed; alasan berhenti
BBCA.json, ...     OHLCV, requested range, actual timestamps, checksum dan waktu fetch
```

File ditulis atomik dengan permission 0600 di directory 0700. Success yang
checksum/window/simbolnya berubah tidak diam-diam digunakan untuk resume.
`-refresh` adalah tindakan eksplisit untuk mengambil ulang window yang sama.
Checksum bukan enkripsi dan bukan bukti bahwa harga provider benar.

**Output ini plaintext backend research data, bukan cache browser terenkripsi.**
Jangan expose directory melalui static hosting atau memasukkannya ke Git. Runtime
default tetap memakai provider/snapshot lamanya; membaca koleksi ini melalui API
memerlukan integrasi berikutnya dengan access control dan bounds yang tetap aktif.

Di laptop pengujian, proses Go tidak dapat menulis ke Documents, sehingga output
live memakai `/private/tmp/signalgen-idx-history-20261014`. Data tersimpan di disk
dan bertahan setelah proses berhenti, tetapi OS dapat membersihkan temporary
directory. Pindahkan salinan yang dibutuhkan ke lokasi penyimpanan penelitian
yang diizinkan sebelum menjadikannya arsip jangka panjang.

## Yang belum dibuktikan

- Kelengkapan terhadap kalender bursa, suspensi/delisting dan corporate actions.
- Kebijakan adjustment split/dividen. Koleksi menyimpan raw OHLCV; null rows
  dilaporkan dan tidak diisi dengan harga buatan.
- Pembaruan incremental dan koreksi harga historis. Window baru memakai koleksi
  baru; `-refresh` mengambil ulang window yang sama, bukan sinkronisasi per tanggal.
- Database/cloud import, katalog UI penuh, screening semua saham dalam satu run,
  cache client encrypted, serta benchmark client/server berskala besar.

## Verifikasi

Tes meliputi XLSX/CSV, tanggal Indonesia, duplikasi, formula/path-like code yang
ditolak, window eksklusif, listing pendek, null OHLCV, corrupt chronology, HTTP
429, resume, corrupt saved data, lock dan output directory yang berisi file lain.

```sh
go test -race ./internal/collection ./internal/marketdata ./cmd/collectidx
go vet ./internal/collection ./internal/marketdata ./cmd/collectidx
```

Tes provider memakai HTTP server lokal deterministik. Run Yahoo nyata dilaporkan
terpisah lewat `report.json`; hasil unit test bukan bukti seluruh ticker sukses.

## Checkpoint pengambilan nyata

Pada 14 Oktober 2026 WITA, seluruh 962 kode dari ekspor resmi dicoba. Sebanyak
921 ticker berhasil disimpan, 41 mendapat HTTP 404 dari Yahoo, dan tidak ada
ticker pending. Total yang tersimpan 217.866 candle, bukan seluruh sejarah pasar.
Contoh BBCA: 238 candle, tanggal 14 Oktober 2025 sampai 13 Oktober 2026.
Null rows/gap dan adjustment masih memerlukan pemeriksaan lanjutan.

Exit code 1 pada batch tersebut disengaja: data provider belum lengkap meskipun
seluruh ticker sudah dicoba. HTTP 404 tidak otomatis membuktikan delisting atau
ketiadaan data dari semua provider. Daftar kegagalan tetap ada di report.

Salinan arsip penelitian disimpan pada folder kerja tugas yang diizinkan
(bukan temporary directory); lokasi lokal diberikan melalui tautan hasil chat.
Folder tersebut berisi file sumber `source-idx.xlsx`, `catalog.json`,
`report.json`, dan 921 snapshot. Itu arsip lokal di luar Git, bukan endpoint
download publik. Struktur sumber dan semua 962 kode juga diperiksa secara
independen menggunakan pembaca workbook; hasilnya cocok dengan importer Go.

Verifikasi: suite `go test ./...` dan `go test -race ./...` backend lolos tanpa
mengaktifkan tes Postgres/cloud opsional. Tes race collector/provider/CLI juga
lolos pada salinan HEAD + perubahan tugas saja; `go vet` dan build CLI lolos.
Tes ini tidak mengubah database cloud atau membuktikan kalender/adjustment harga.
