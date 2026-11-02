# Analisis semua sinyal — kontrak 2 November 2026

Mode utama `#app/backtest` adalah **Analyse every signal**. Ini berbeda dari
**Portfolio simulation**, yang tetap memakai `backtest-2 / holding-next-open-1`.
Arsip Claudio tidak diubah. Kedua mode bukan eksekusi transaksi broker.

## Perhitungan

Setiap keputusan rule pada candle harian selesai dihitung secara independen.
Tidak ada modal, posisi terbuka, biaya atau slippage yang membuang sinyal pada
mode studi. Rule privat tetap dievaluasi server; indikator dan analisis harga
berjalan di browser melalui worker Go/WASM.

- Harga acuan: **Close candle sinyal**, bukan harga fill yang dijanjikan.
- T+1: candle perdagangan berikutnya yang tersedia untuk simbol itu. Hari libur
  tidak dibuatkan candle palsu. Data provider belum dijamin tanpa gap.
- Untuk setiap T+1…T+n, bandingkan Open, High dan Close. Default n=3, batas 1–100.
- BUY: `(harga evaluasi - close acuan) / close acuan * 100`.
  SELL membalik tanda: **analisis arah**, bukan transaksi short yang dieksekusi.
- Return positif = win, negatif = loss, nol = flat. Win rate menggunakan jumlah
  kejadian yang memiliki data evaluasi; flat termasuk denominator, data kurang
  tidak termasuk. Rata-rata return ditimbang berdasarkan jumlah kejadian.
  `sum_return_pct` hanya akumulator untuk mean, **bukan return portofolio**.
- High berarti potensi pergerakan historis. Harga tersebut belum tentu bisa
  diperoleh pengguna; pada SELL kenaikan High adalah pergerakan yang merugikan.
- TP/SL opsional, masing-masing persentase positif di bawah 100. Pemeriksaan
  mulai T+1, menggunakan High/Low sampai n candle. Jika keduanya tersentuh pada
  candle sama, **SL dahulu**. Jika tidak tersentuh, Close T+n; jika masa depan
  belum cukup, `incomplete`, bukan loss atau exit buatan. Jika barrier sudah
  tersentuh sebelum data berakhir, hasilnya sudah dapat dievaluasi.

Ringkasan mencakup semua horizon, swing, simbol (termasuk nol sinyal), dan hari
sinyal. Detail CSV menyertakan **setiap** horizon O/H/C serta outcome swing.
UI menampilkan horizon terakhir pada baris detail, 50 sinyal per halaman, dan
30 ringkasan horizon per halaman; ringkasan per simbol/hari dipaginasi 25 baris.

## Sumber dan batas

Sumber: universe milik akun, seluruh katalog IDX, atau seluruh katalog AS yang
didukung importer (Nasdaq/NYSE, bukan seluruh venue/OTC). IDX/IDR dan AS/USD
tidak dicampur. Katalog aktif saat run dimulai dibekukan dan di-hash; ini **bukan**
katalog historis point-in-time dan masih memiliki risiko survivorship bias.

Default tanggal adalah satu bulan kalender terakhir yang selesai, maksimum satu
tahun. Warmup mengikuti operand rule; data buffer mencakup horizon evaluasi.
Tanggal memakai tanggal sesi UTC seperti kontrak dataset harian yang sudah ada.
Universe screener langsung tetap maksimal sepuluh saham. Pada studi seluruh
pasar, sepuluh adalah **ukuran batch**, bukan batas total katalog.

Satu worker dipakai ulang, satu batch browser aktif, maksimal tiga pengambilan
provider paralel dalam batch. Shared provider cache/coalescing/batas paralel
yang sudah ada tetap digunakan. Kegagalan satu simbol dilaporkan terpisah.
Retry saham gagal melewati komputasi dan agregasi saham yang sudah berhasil.
429 menghormati `Retry-After`, maksimal dua retry, jeda dibatasi dua menit;
Stop tetap membatalkan jeda. Penolakan sesi/izin/versi tidak dicoba tanpa batas.

Konteks proses: maksimal 32 per instance dan satu per pasangan akun/sesi, TTL
dua jam. Snapshot tetap mengikuti batas penyimpanan dataset yang sudah ada
(default 128 global, 16 per akun, 32 MiB). Batas ini dapat menolak beban tinggi;
tidak berarti sistem siap ribuan pengguna produksi. Ketika batch selesai,
snapshot privat dilepas; shared cache harga tidak dibatalkan/dihapus.

Detail hasil memakai tuple ringkas IndexedDB per akun/run, batas aplikasi
128 MiB per akun; tidak ditumpuk di React state. Gagal kuota menghentikan run,
meninggalkan hasil yang sudah tersimpan agar dapat diekspor. Candle studi berada
di memori selama perhitungan dan tidak dipersistenkan plaintext; mekanisme AES-GCM
cache historis screener tetap terpisah. Detail studi adalah data turunan sementara,
bukan jurnal authoritative, dan dibersihkan saat keluar halaman/logout/akun
berganti. Metadata ID konteks di sessionStorage memungkinkan cleanup setelah
reload; tidak berisi token, candle, harga atau rule definition.

## HTTP dan WASM

API OpenAPI **0.15.0**, capabilities **capabilities-5**. Core indikator tetap
`core-0.5.0`, feature vector tetap `screener-features-1`, worker protocol tetap
`worker-2`. Penambahan ini memiliki schema/policy tersendiri dan tidak mengubah
format arsip `backtest-2`.

1. `POST /api/v1/backtests/studies`

   ```json
   {"source":"market","market":"IDX","rule_id":"default-scalping-v1","config":{"from":"2026-10-01","to":"2026-10-31","n_steps":3,"take_profit_pct":5,"stop_loss_pct":3}}
   ```

   Untuk universe: `source=universe`, `universe_id` milik akun. Pasar/mata uang
   aktual selalu diturunkan server dari instrumen, tidak dipercayakan pada JSON.
   Respons 201: ID konteks, hash katalog/rule, versi engine/schema/policy,
   konfigurasi, jumlah saham/batch dan expiry. Tidak ada background job.
2. `POST /api/v1/backtests/studies/{id}/batches/{index}/prepare`, body `{}`.
   Index mulai nol. Retry dapat mengirim `{"retry_symbols":["BBCA.JK"]}`,
   hanya subset unik dari batch yang sudah dibekukan; ini mencegah saham berhasil
   menghabiskan kapasitas snapshot lagi. Respons: `stocks`, `manifests`, `failures` per simbol
   (`PROVIDER_UNAVAILABLE`, `INSUFFICIENT_CANDLES`, `SNAPSHOT_CAPACITY`). Status 200
   dapat memuat hasil parsial. Tidak menerima simbol di luar batch atau owner dari client.
3. Ambil manifest/content lewat API dataset yang ada. Cek ukuran dan SHA-256;
   manifest/content mengikat `study_id`, rule hash, pasar, tanggal dan horizon.
4. Hitung fitur seluruh riwayat satu simbol di `signalgenComputeBacktestFeatures`.
   Buat compute grant biasa dengan purpose `backtest` dan hash rule yang dibekukan.
5. `POST /api/v1/backtests/signals` memakai
   `policy_version=signal-close-independent-1`. Semua timestamp kandidat dari
   index 19 sampai akhir snapshot wajib ada, termasuk warmup/buffer. Server
   memeriksa sesi, entitlement, owner, checksum/versi, rule hash, crossover,
   offset, AND/OR dan cooldown. Rule berubah → mulai ulang.
6. Worker memanggil `signalgenRunSignalStudy` dengan schema `signal-study-1`,
   config, series, dan entries BUY/SELL. Tidak ada private decision export di WASM.
7. `DELETE /api/v1/backtests/studies/{id}/batches/{index}/prepare` melepas batch.
   `DELETE /api/v1/backtests/studies/{id}` membatalkan konteks. Respons terlambat
   setelah cancel tidak boleh menerbitkan snapshot baru.

Semua endpoint memerlukan bearer + `X-App-Session`, entitlement `backtest` aktif,
ownership/sesi yang sesuai, dan rate/capacity check. ID konteks bukan pengganti
otorisasi. Snapshot yang sudah diunduh tetap bisa dianalisis oleh pemilik browser;
Model A bukan DRM atau bukti kebenaran feature vector dari client yang dimodifikasi.

## Verifikasi yang dapat diulang

- `go test -race ./...` dari backend.
- `python3 scripts/check_signal_study_claudio.py`: source/input SHA dibekukan;
  24 perbandingan rumus basis harga, BUY/SELL dan TP/SL lengkap. Perbedaan
  incomplete horizon dijelaskan; **tidak mengklaim parity penuh Claudio**.
- `node scripts/check_backtest_wasm.mjs <wasm> <absolute wasm_exec.js>`:
  legacy portfolio, keluarga indikator Claudio, serta studi BUY/SELL horizon
  1/3/100, TP/SL, data kurang dan native/WASM.
- `npm test`, `npm run build`, `npm run test:study` dari frontend/web.
- `go run ./scripts/benchmark_model_a.go`: eksperimen CPU sintetis lokal.
- `SIGNALGEN_TEST_PERFORMANCE_OUTPUT=/tmp/study-http.json go test ./internal/api/tests -run TestStudySyntheticHTTPAdmission -count=1`:
  admission HTTP lokal dengan auth/provider sintetis, bukan beban ke cloud.

Hasil yang benar-benar sudah dijalankan dan batasnya dicatat pada
[bahan asis](../ASIS_2026_11_04.md), terpisah dari smoke test provider asli.
