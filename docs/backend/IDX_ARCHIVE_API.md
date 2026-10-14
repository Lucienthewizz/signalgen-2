# Arsip IDX ke screener — 14 Oktober 2026

## Hasil tahap ini

Backend memilih sumber saat startup: `yahoo` (default, request Yahoo seperti
sebelumnya) atau `idx_archive` (baca arsip lokal, tanpa request jaringan ke Yahoo).
Mode arsip **bukan real-time** dan tidak fallback diam-diam ke Yahoo.
Model A, auth, database dan UI tidak diubah. Layanan API yang sebelumnya berjalan
tidak otomatis direstart atau diganti konfigurasinya.

```text
Login + app session + entitlement
  → pilih rule dan universe milik pengguna
  → prepare dataset
  → baca snapshot terpilih, cek window/SHA/OHLCV
  → cache publik terbatas di RAM
  → dataset ID/content terikat pemilik
  → perhitungan client/WASM + keputusan server Model A yang sudah ada
```

Pemilik universe diperiksa sebelum provider dipanggil. Harga dapat dibagikan
melalui cache internal; handle dataset, rule, grant dan hak akses tetap pribadi.
Arsip bukan static directory atau endpoint download publik.

Satu prepare tetap maksimal **3 saham**, masing-masing sampai **100 candle terakhir**,
minimal 20 untuk warmup. Seluruh sejarah tetap ada di arsip; tidak diunduh ulang
untuk setiap pengguna. Katalog DB/UI **tidak diganti** oleh katalog 962 kode.
Import katalog penuh, universe besar, batching/pagination dan benchmark adalah
tahap terpisah. Mengoleksi seluruh IDX tidak sama dengan screening semuanya.

Failed/pending ticker, file hilang atau riwayat kurang dari 20 candle menghasilkan
provider unavailable. Hash, simbol, window, jumlah candle, OHLC atau chronology
yang salah menghasilkan invalid data. Request gabungan tidak mengembalikan
sebagian saham diam-diam. Error ini **bukan no match**: input belum dapat dievaluasi.

## Konfigurasi lokal

Dari `backend`, dengan Go sesuai `go.mod`. Environment auth/DB yang sudah ada
masih diperlukan, tetapi jangan tampilkan isinya.

```sh
SIGNALGEN_MARKET_DATA_MODE=idx_archive \
SIGNALGEN_IDX_HISTORY_DIR="/absolute/path/to/idx-archive" \
go run ./cmd/api
```

Directory berisi `catalog.json`, `report.json`, dan snapshot seperti `BBCA.json`.
Startup memeriksa metadata/catalog binding dan lock, bukan membaca semua file.
Snapshot terpilih divalidasi saat pembacaan. Duplicate/path-like code, JSON field
tak dikenal, trailing JSON, symlink/non-regular files dan `.collect.lock` ditolak.

Arsip harus immutable selama API berjalan. Jangan menjalankan collector/refresh
pada directory itu. Siapkan koleksi baru, validasi, lalu restart dengan path baru.
Cache RAM tetap menggunakan batas ukuran/jumlah/TTL sebelumnya; mengubah file
di belakang cache bukan mekanisme refresh. Mode salah/path tidak tersedia menolak
startup, tanpa fallback. Set `SIGNALGEN_MARKET_DATA_MODE=yahoo` lalu restart untuk
kembali ke request provider lama.

## Docker / OrbStack

Override opsional membuat bind mount **read-only**. Path harus sudah ada dan
tidak disalin ke image/Git. Contoh dari root repository:

```sh
export SIGNALGEN_IDX_HISTORY_HOST_DIR="/absolute/path/to/idx-archive"
# Local development: read your 0700/0600 files as their unprivileged owner.
export SIGNALGEN_ARCHIVE_UID="$(id -u)"
export SIGNALGEN_ARCHIVE_GID="$(id -g)"

# Validate without printing expanded environment/secrets.
docker compose -f docker-compose.yml -f docker-compose.idx-history.yml config --quiet

# Only when intentionally replacing this Compose go-api service.
docker compose -f docker-compose.yml -f docker-compose.idx-history.yml up -d --build go-api
```

Jangan gunakan UID 0. Deployment default memakai UID/GID 10001; siapkan salinan
yang bisa dibaca user itu. Jangan membuat arsip asli world-readable, menghapus
container/volume lain, atau menimpa stack lain. Sesuaikan port bila 8080 sudah
digunakan. Compose menolak path host kosong; `create_host_path: false` mencegah
membuat directory kosong sebagai pengganti arsip yang salah.
Referensi: [Docker Compose volumes](https://docs.docker.com/reference/compose-file/services/#volumes).

## Kontrak dan provenance

Endpoint dan `ohlcv-multi-1` tidak berubah. `manifest.provider` tetap
`yahoo_finance` karena asal harga adalah Yahoo, kompatibel dengan enum frontend
lama. Tambahan `quality.warnings` membawa window eksklusif, waktu koleksi,
jumlah ticker success, **NOT real-time**, dan kalender/adjustment belum diverifikasi.
Metadata ini diteruskan melalui cache, tidak hilang saat provider dibungkus.

`available_range` adalah tanggal candle yang dikirim, bukan seluruh arsip.
`quality.status=complete` mempertahankan kontrak lama: payload terpilih valid,
**bukan** bukti semua tanggal bursa/emiten/corporate actions lengkap. Selalu baca
warnings dan range. UI lama belum tentu menampilkan warnings; indikator mode
historical/live di UI tidak dibuat pada slice ini.

SHA-256 bukan enkripsi atau tanda tangan provider. Arsip tetap plaintext research
data, bukan cache browser terenkripsi. Keamanan login/RLS tidak berarti data
browser otomatis terenkripsi.

## Verifikasi

```sh
# Deterministic tests: no Yahoo, credentials or database needed.
go test -race ./internal/collection ./internal/marketdata ./internal/dataset ./cmd/api
go vet ./internal/collection ./internal/marketdata ./internal/dataset ./cmd/api

# Opt-in archive → cache → private dataset check, no DB/cloud mutation.
SIGNALGEN_IDX_HISTORY_TEST_DIR="/absolute/path/to/idx-archive" \
go test -race -v ./internal/collection ./internal/dataset \
  -run 'TestArchiveResearchFiles|TestArchiveDatasetResearchFiles'
```

Tes meliputi bounded output, warmup, failed/pending/missing data, tanpa partial
success/fallback, corrupt hash/window/symbol/count/OHLCV, trailing JSON, symlink,
cancel, concurrent readers, provenance melalui cache, dan owner isolation.

Run arsip lokal lolos: BBCA, BBRI dan TLKM masing-masing 100 candle dari 18 Mei
sampai 13 Oktober 2026. Dataset BBCA terikat pemilik, owner lain ditolak.
Ini bukti adapter→cache→dataset dengan file nyata, **bukan** verifikasi browser
UI/login/cloud/semua saham end-to-end.

Suite backend `go test -race ./...`, vet paket terkait dan build API juga lolos
pada salinan hanya HEAD + perubahan tugas yang staged. Perubahan lokal lain
tidak diperlukan untuk slice ini. Tes database/cloud opsional tidak diaktifkan.
Konfigurasi Compose lolos `config --quiet`; container aktif tidak diganti.

Koleksi asal: 962 ticker dicoba, 921 success, 41 Yahoo HTTP 404, 0 pending,
217.866 candle tersimpan. HTTP 404 bukan bukti delisting. Kalender/suspensi,
adjustment, incremental refresh, RLS cloud dan benchmark besar belum dibuktikan.
