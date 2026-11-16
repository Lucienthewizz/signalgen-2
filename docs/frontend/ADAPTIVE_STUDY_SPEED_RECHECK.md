# Uji ulang kecepatan pool adaptif

Pool belum terbukti lebih cepat pada pengujian ini. Source yang diuji adalah `c050f876e3c25409fa7e25d38d4363a162a025ae`.

| Beban, 23 saham | Satu worker | Adaptif | Perubahan waktu |
|---|---:|---:|---:|
| 250 candle/saham, 3 operand | 2,54 detik | 2,76 detik | +8,6% |
| 1.250 candle/saham, 5 operand | 3,36 detik | 3,46 detik | +3,0% |

Angka adalah median waktu keseluruhan dari dua pasangan bergantian per beban, dengan empat pengamatan viewport/tema per skenario. Pengamatan ini berasal dari satu lingkungan; selisih kecil belum membuktikan perbedaan yang signifikan. Pada beban kecil, kedua mode memakai satu worker, sehingga selisihnya menunjukkan variasi antar-run dan tidak dapat dianggap sebagai overhead pool.

Browser, Worker, Go/WASM, dan IndexedDB nyata berjalan dalam container offline dengan batas 2 CPU dan 3 GiB RAM. API dan harga menggunakan fixture sintetis. Beban berat mencapai tiga pekerjaan indikator outstanding, sedangkan baseline satu. Semua empat pembanding dalam container lulus: event, ringkasan, dan CSV kedua mode identik. Tidak ada worker tersisa pada pengukuran akhir.

Median dari p50 indikator per-run pada beban berat adalah 20,4 ms untuk baseline dan 74,0 ms untuk adaptif. Data mendukung mempertahankan pendekatan konservatif; belum ada dasar untuk menjanjikan percepatan atau menaikkan jumlah worker.

Pengujian ini tidak mengukur puncak RAM, katalog IDX penuh, unduhan Yahoo, atau jaminan selesai dalam lima menit. Branch fitur belum digabung ke aplikasi pengguna.

Reproduksi menggunakan `docs/evidence/adaptive-study-workers-reproduce.py` tanpa `--smoke`, dengan input dependensi dan WASM yang telah disetujui. Detail per-run, hash bukti mentah, dan keterbatasan tersimpan di [bukti JSON](../evidence/adaptive-study-workers-speed-recheck-20261116.json).
