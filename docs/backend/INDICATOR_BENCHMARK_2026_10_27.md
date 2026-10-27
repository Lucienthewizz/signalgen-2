# Pengukuran indikator — 27 Oktober 2026

Hasil pada Apple M5, RAM 16 GiB, macOS arm64. Browser Chrome headless desktop, tanpa CPU throttling. Data OHLCV sintetis; tidak memakai akun, provider pasar, scoring privat, atau simulasi portfolio. Kode engine yang diukur: `3ea6982` (`core-0.5.0`).

**Pemakaian biasa cepat pada mesin ini.** Ichimoku B untuk 10 saham × 100 candle memerlukan median sekitar 4,8 ms melalui worker browser. Skenario maksimum 40 operand untuk 10 saham × 2.500 candle memerlukan sekitar 1,38 detik. Nama indikator yang jarang dipakai tidak menyebabkan seluruh katalog dihitung.

| Beban | Native Go, median ms | Worker browser, median ms | Worker browser, p95 ms |
| --- | ---: | ---: | ---: |
| Basis, 1 saham × 100 candle | 0.0056 | 0.50 | 1.40 |
| Ichimoku B, 1 × 100 | 0.0355 | 0.70 | 4.90 |
| Ichimoku B, 10 × 100 | 0.3691 | 4.80 | 5.60 |
| ADX250_PREV_250, 10 × 830 | 1.4685 | 38.50 | 40.30 |
| Ichimoku B, 10 × 2.500 | 13.0944 | 166.20 | 169.00 |
| 40 operand, 10 × 2.500 | 152.8750 | 1380.60 | 1426.30 |

Native Go mengukur komputasi core satu batch, termasuk validasi dan pembentukan hasil; decoding/encoding JSON dan startup proses tidak masuk bagian yang diberi timer. Angka native merupakan median lima rata-rata ns/op Go benchmark, bukan p95 per permintaan.

Browser mengukur fungsi worker aplikasi yang sesungguhnya: pengiriman candle, serialisasi, Go/WASM, parsing hasil dan pengembalian seluruh hasil. Setiap kasus memakai 3 warmup dan 15 sampel; p95 adalah persentil empiris sampel kecil (pada 15 sampel nilainya maksimum), bukan jaminan SLA. Data/setup dan validasi hasil di luar timer. OHLCV deterministik identik antara harness Go dan browser.

Screener memakai worker yang dipakai ulang. Backtest membuat dan menghentikan worker baru pada setiap job; sampel backtest di tabel sudah mencakup startup tersebut, dengan cache HTTP/kompilasi browser dipertahankan. Kedua jalur ini tidak boleh dibandingkan sebagai pengukuran core murni.

Panggilan screener pertama dalam sesi browser: **87.10 ms**, termasuk penghitungan basis. Loader Go/WASM saja pada tujuh worker baru setelah pengujian: median **24.30 ms**. Cache HTTP/kompilasi tetap dipertahankan; ini bukan pengunduhan internet dengan cache kosong.

## Tiga rumus yang selalu dihitung

Pada native Go, EMA9 + EMA20 + RSI14 saja memerlukan median:
- 100 candle per saham: 0.000444 ms.
- 2500 candle per saham: 0.010422 ms.

Ini hanya biaya tiga rumus, di luar validasi, JSON, pembentukan fitur dan startup worker. Angka ini tidak boleh diklaim sebagai penghematan end-to-end jika tiga rumus dihapus. Masih ada pekerjaan ekstra di implementasi saat ini, tetapi benchmark basis satu saham/100 candle secara keseluruhan berada sekitar 0,5 ms pada browser ini.

Native worst-case mengalokasikan sekitar 171.2 MiB kumulatif per batch. B/op adalah total alokasi, bukan peak RAM atau kebocoran memori. Peak RAM/browser CPU belum diprofilkan.

## Batas bukti

- Hasil khusus perangkat ini; belum mengukur HP, CPU lemah, tab background, atau banyak pengguna serentak.
- Waktu unduh data provider, autentikasi, scoring privat dan simulasi transaksi/P&L belum termasuk. Total waktu tombol Run dapat lebih besar.
- Tidak ada perubahan algoritma produksi/optimasi yang dibuat oleh pekerjaan benchmark ini.

## Mengulang pengukuran

Jalankan secara berurutan agar benchmark CPU tidak saling mengganggu. Vite dan WASM yang cocok perlu tersedia pada 127.0.0.1:5174.

```sh
cd backend
go test ./core -run '^$' -bench 'Benchmark(IndicatorBatch|LegacyIndicatorMath)$' -benchmem -benchtime=300ms -count=5
cd ../frontend/web
SIGNALGEN_TEST_PLAYWRIGHT_CLI=/path/to/playwright-cli node scripts/benchmark-indicators.mjs
```

Opsional: `SIGNALGEN_TEST_BROWSER_EXECUTABLE` untuk executable Chrome; `SIGNALGEN_TEST_BASE_URL` untuk origin Vite lain. Browser harness memerlukan endpoint modul `/src`, sehingga gunakan Vite dev server. Data mentah browser berada pada `frontend/web/output/playwright/indicators-benchmark.json` (diabaikan Git).

[Hasil mentah yang dibekukan, termasuk versi browser dan sampel](benchmarks/indicators-2026-10-27.json).
