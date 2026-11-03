# Audit data katalog — 2 November 2026

`cmd/auditcatalog` memeriksa katalog aktif IDX atau AS dan ketersediaan OHLCV
Yahoo. Ini alat operator baca-saja: tidak mengakses rule/jurnal pengguna,
tidak membuat grant, tidak menulis Supabase, dan tidak membuktikan hasil rule.
Universe screener tetap maksimal sepuluh saham. Tidak ada endpoint publik baru.

Katalog aktif dibaca sekali lalu dibekukan: simbol, provider symbol, exchange,
currency, pasar dan SHA-256. Katalog/dates berbeda tidak boleh melanjutkan
laporan lama. Katalog AS terbatas venue yang diimpor (Nasdaq/NYSE), bukan OTC
atau seluruh saham yang pernah tercatat. Katalog aktif bukan point-in-time.

Pengambilan memakai satu worker serial, default jeda satu detik; 429 langsung
menghentikan audit setelah kebijakan retry provider yang sudah ada. Tiga kegagalan
sementara berurutan juga menghentikan proses. Tidak ada ribuan request paralel.
Default budget lima menit. `-budget 0` berarti sampai selesai/provider stop dan
hanya digunakan jika durasi tersebut memang diinginkan.

Setiap ticker tetap tercantum di `report.json`:

- `pending`: belum selesai diperiksa; tidak boleh dianggap sukses.
- `valid`: candle tervalidasi dan minimal 20 baris; bukan bukti semua indikator
  memiliki warmup cukup atau seluruh sesi bursa tercakup.
- `insufficient`: data valid, tetapi kurang dari 20 candle.
- `failed`: kode kegagalan provider/data tanpa body, SQL atau kredensial.

`coverage_complete` berarti semua ticker sudah dicoba, termasuk yang gagal.
`all_usable` hanya true bila semuanya valid. Keduanya bukan profitabilitas,
kesetaraan Claudio, jaminan lisensi atau bukti analisis rule seluruh pasar.
Laporan mencatat window `[from,to)`, timestamp aktual, jumlah candle, checksum
OHLCV dan warning. Candle/credential tidak disimpan dalam laporan ini.

Data harian memeriksa simbol/currency/interval provider bila tersedia, dan
menolak balasan yang tidak cocok. Split/dividen yang dilaporkan Yahoo dalam
rentang candle serta gap lebih dari empat hari kalender menghasilkan warning.
Tidak ada kalender bursa lengkap: gap dapat berasal dari libur/suspensi/data
hilang. Tidak membuat candle palsu atau mengubah harga secara diam-diam.
Harga memakai OHLCV provider tanpa penyesuaian tambahan SignalGen; bukan
total-return series, dan `adjclose` tidak menggantikan Close untuk indikator.

## Menjalankan dan melanjutkan

Image Go menyediakan `signalgen-audit-catalog`. Environment memakai konfigurasi
backend yang sudah ada; jangan menyalin koneksi DB ke chat atau command history.

```sh
docker compose exec go-api signalgen-audit-catalog \
  -market IDX -from 2026-07-01 -to 2026-11-02 \
  -budget 5m -delay 1s -out /tmp/idx-audit-20261102
docker compose exec go-api signalgen-audit-catalog \
  -market US -from 2026-07-01 -to 2026-11-02 \
  -budget 5m -delay 1s -out /tmp/us-audit-20261102
```

Ulangi command yang sama untuk melanjutkan pending. Tambahkan `-retry-failed`
untuk mencoba ulang failed/insufficient; valid tidak diunduh ulang. Exit code 1
pada laporan parsial/gagal memang disengaja agar otomasi tidak melaporkan sukses
penuh. Error budget tidak mengubah ticker aktif menjadi kegagalan data palsu.

Folder laporan di `/tmp` container hilang saat container dibuat ulang. Salin ke
folder operator yang dipertahankan sebelum rebuild; perintah `docker cp`
menggunakan nama container yang terlihat pada `docker compose ps`.
Lock `.audit.lock` mencegah dua proses menulis laporan sama. Jika proses terputus
paksa dan meninggalkan lock, pastikan tidak ada audit aktif sebelum melepasnya.

Tes fixture mencakup 23 saham, resume tanpa duplikasi, retry hanya kegagalan,
binding katalog/window, rate limit dan cancellation. Hasil provider nyata tetap
dicatat terpisah dari fixture dan hasil evaluasi rule di browser.

## Hasil provider asli, 2 November

Window 1 Juli hingga sebelum 2 November 2026, harian, budget lima menit per
pasar sesuai pilihan pengguna. Kunjungan berurutan menurut simbol, bukan sampel
acak dan bukan seluruh pasar selesai:

| Pasar | Katalog aktif | Valid | <20 candle | Gagal | Belum dicoba |
| --- | ---: | ---: | ---: | ---: | ---: |
| IDX | 962 | 273 | 0 | 5 | 684 |
| AS | 5.600 | 273 | 3 | 0 | 5.324 |

Keduanya `coverage_complete=false`, berhenti karena budget. Lima respons 404:
ARMY.JK, BTEL.JK, CBMF.JK, COWL.JK, CPRI.JK. Jangan menyimpulkan delisting atau
menghapus katalog otomatis hanya dari 404 Yahoo. AS: ACCV 19 candle, ADIL 3,
AIOK 16; penyebab riwayat pendek belum dipastikan. Data yang valid umumnya
86 candle pada window ini. Provider melaporkan corporate action pada 39 ticker
IDX dan 91 ticker AS yang diperiksa; itu bukti warning, bukan penyesuaian return.

Laporan lengkap lokal dipertahankan di
`backend/runtime/catalog-audits/20261102/IDX/report.json` dan
`backend/runtime/catalog-audits/20261102/US/report.json`, gitignored. Resume lokal
menggunakan direktori yang sama dan window yang sama. Jika memakai image Docker,
salin masing-masing folder ke `/tmp` container terlebih dahulu lalu gunakan
`-out` yang sesuai; jangan menimpa folder audit yang sedang dipakai proses lain.
Ringkasan aman untuk repository ada di
[artefak bukti](../evidence/catalog-data-audit-20261102.json).

### Resume kedua, 2 November

Sesuai pilihan pengguna, pending saja dilanjutkan lima menit lagi per pasar;
failed/insufficient sebelumnya tidak di-retry. Katalog beku, hash dan window
tetap sama. Angka kumulatif setelah dua pass:

| Pasar | Katalog | Valid | <20 candle | Gagal | Belum dicoba |
| --- | ---: | ---: | ---: | ---: | ---: |
| IDX | 962 | 530 | 0 | 19 | 413 |
| AS | 5.600 | 548 | 4 | 0 | 5.048 |

Semua 19 gagal IDX berupa respons provider 404; ticker baru yang gagal tercantum
pada [bukti resume](../evidence/catalog-data-audit-resume-20261102.json), bukan
otomatis dianggap delisting. Tambahan riwayat pendek AS: AMRO, 12 candle. Warning
corporate action kumulatif pada 68 ticker IDX dan 175 AS. Laporan tetap parsial,
`coverage_complete=false`; screening rule seluruh pasar belum diuji penuh.
