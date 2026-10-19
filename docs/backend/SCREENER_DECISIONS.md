# Memahami backend screener: match bukan BUY

Penjelasan ini mengikuti implementasi Go yang aktif pada 19 Oktober 2026.
Contoh angka adalah latihan membaca program, bukan rekomendasi transaksi.

## 1. Dua pertanyaan yang berbeda

`matched` menjawab: apakah kandidat lolos rule dan boleh menghasilkan sinyal?
`signal_type` menjawab: arah apa yang sudah ditetapkan pada rule tersebut?

| Kondisi dan cooldown | Arah rule | Respons keputusan | Arti |
| --- | --- | --- | --- |
| Lolos | BUY | `matched: true`, `signal_type: BUY` | Rule beli cocok |
| Lolos | SELL | `matched: true`, `signal_type: SELL` | Rule jual cocok |
| Tidak lolos | BUY atau SELL | `matched: false`, tanpa arah sinyal | Tidak ada sinyal dari rule itu |
| Rumus lolos, tetapi cooldown aktif | BUY atau SELL | `matched: false`, `COOLDOWN_ACTIVE` | Sinyal ditahan; bukan rumus salah |

`BUY` dan `SELL` bukan pengganti nilai boolean. Keduanya adalah arah hasil ketika
rule lolos. Backend tidak otomatis memilih BUY karena RSI rendah atau SELL karena
harga turun. Pengguna memilih arah saat membuat rule. Oleh karena itu, arah dan
syarat yang dipilih pengguna harus masuk akal; engine tidak membuktikan strategi
itu menguntungkan dan tidak mengetahui apakah pengguna memiliki saham tersebut.

Contoh:

```json
{
  "name": "Contoh belajar",
  "logic": "AND",
  "signal_type": "BUY",
  "cooldown_sec": 0,
  "conditions": [{"left": "RSI14", "op": "<", "right": 30}]
}
```

Jika RSI14 = 23,52, ekspresi `23.52 < 30` bernilai benar. Jika cooldown tidak
menghalangi, responsnya:

```json
{
  "symbol": "ANTM.JK",
  "timestamp": "2026-10-19T00:00:00Z",
  "matched": true,
  "signal_type": "BUY",
  "reason_codes": ["RULE_MATCHED"]
}
```

Ini contoh bentuk respons; timestamp di atas ilustrasi, bukan salinan respons
provider. Jika rule yang sama diberi arah SELL, kondisi matematikanya tetap benar
tetapi arah sinyal menjadi SELL. Tes `TestMatchAndSignalDirectionAreSeparate`
membuktikan pemisahan ini. Jika RSI14 = 50, kondisi salah dan kedua arah tersebut
tidak menghasilkan sinyal.

Tidak ada order broker yang dikirim. `matched: false` pada rule BUY juga **bukan**
berarti SELL, dan sebaliknya. Model A/B adalah pilihan pembagian komputasi,
bukan dua model machine learning yang otomatis meramal harga.

RSI berskala 0–100, sedangkan PRICE/EMA memakai mata uang dataset. Membandingkan
`RSI14 > EMA20` dapat diterima secara sintaks tetapi membandingkan dua besaran
berbeda; hasil false bukan otomatis error backend. Validasi program tidak
membuktikan bahwa pilihan syarat pengguna bermakna secara analisis.

## 2. Alur satu kali Run screening

1. Browser mengirim rule ID dan universe ID. Backend memeriksa identitas, sesi
   aplikasi, status akun, entitlement, serta kepemilikan resource. Tidak cukup
   hanya menyembunyikan tombol di UI.
2. Backend menyiapkan snapshot OHLCV dari provider melalui adapter dan cache yang
   berlaku. Manifest mencatat sumber, simbol, mata uang, periode, kualitas dan
   checksum. Katalog IDX/Nasdaq/NYSE adalah daftar instrumen; Yahoo Finance adalah
   sumber harga yang digunakan adapter saat ini.
3. Browser mengambil data yang diizinkan dan memverifikasinya. Go/WASM dalam
   Web Worker menghitung PRICE, EMA9, EMA20 dan RSI14. Indikator tidak berasal
   dari angka random atau dari label BUY/SELL Yahoo Finance.
4. Backend menerbitkan compute grant yang terikat ke sesi, dataset dan versi
   rule. Browser meminta socket ticket sekali pakai untuk membuka WebSocket.
5. Browser mengirim kandidat ringkas: simbol, waktu candle dan feature vector.
   Handler WebSocket memeriksa ticket, sesi, entitlement, grant, versi dan scope
   dataset; izin diperiksa kembali sebelum batch dievaluasi.
6. `EvaluateBatch` mengelompokkan kandidat per saham. `EvaluateDecision`
   memvalidasi rule dan kandidat, memeriksa kondisi berurutan, lalu cooldown.
   Pengelompokan mencegah candle/cooldown satu saham dipakai untuk saham lain.
7. Server mengembalikan `matched`, arah jika ada sinyal, serta alasan per kandidat.
   Frontend mengambil keputusan candle terbaru untuk setiap saham, menampilkan
   detail, lalu menyimpan snapshot riwayat yang sudah disanitasi.

Satu WebSocket adalah transport, bukan evaluator. Pada batch kecil yang muat
batas ticket, beberapa saham berbagi satu koneksi. Dataset/batch yang melebihi
batas dapat memakai beberapa koneksi berurutan; jangan menjanjikan selalu satu.

Backend memvalidasi bentuk/nilai/scope fitur dan menilai rule, tetapi tidak
menghitung ulang seluruh indikator dari OHLCV untuk membuktikan kebenaran setiap
angka dari client. Access control tidak berarti client bebas manipulasi.
Hasil analisis ini bukan bukti transaksi atau dasar mengubah izin akun.

## 3. Apa yang diperiksa evaluator?

Untuk setiap kandidat pada satu saham, urutannya:

```text
Validasi → cek rumus AND/OR → jika salah: CONDITIONS_NOT_MET
                            → jika benar: cek cooldown
                                → masih jeda: COOLDOWN_ACTIVE, tanpa sinyal
                                → boleh: RULE_MATCHED + arah BUY/SELL dari rule
```

AND membutuhkan semua kondisi benar. OR membutuhkan minimal satu kondisi benar.
Contoh dua kondisi bernilai `true` dan `false`: AND tidak lolos, OR lolos.
Kondisi lain yang false pada OR tidak membatalkan kondisi pertama yang true.

Crossover memakai **dua candle**:

```text
CROSS_UP:   kiri_sebelumnya <= kanan_sebelumnya DAN kiri_sekarang > kanan_sekarang
CROSS_DOWN: kiri_sebelumnya >= kanan_sebelumnya DAN kiri_sekarang < kanan_sekarang
```

Jika kanan adalah EMA20, nilai EMA20 candle sebelumnya dan sekarang dapat berbeda.
Jika kanan angka 70, batasnya tetap 70. Contoh RSI 71 → 69 memenuhi CROSS_DOWN 70;
RSI 71 → 70 belum memenuhi karena nilai sekarang harus benar-benar lebih kecil.
Tanpa kandidat sebelumnya, evaluator tidak memicu crossover.

Cooldown yang aktif sekarang dilacak per saham **dalam evaluasi batch tersebut**.
Ini bukan penyimpanan alarm permanen lintas semua klik Run. Pada candle harian,
jeda antarcandle biasanya jauh lebih panjang daripada default cooldown 300 detik.
Perilaku alarm real-time/lintas-run membutuhkan desain terpisah.

## 4. Mengapa hasil kemarin bisa salah tampil?

Backend sudah mengirim arah sinyal, tetapi sanitizer riwayat frontend hanya
mengizinkan daftar field lama. `signal_type` dan `prevFeatures` terbuang.
UI lalu menebak arah yang hilang sebagai BUY dan menilai crossover tanpa
candle sebelumnya sebagai false. Kesalahan terjadi saat menyimpan/membaca
hasil, bukan karena evaluator Go mengubah rule SELL menjadi BUY.

Perbaikannya:

- Simpan dan validasi BUY/SELL serta previous features, sambil tetap membuang
  token/field yang tidak dibutuhkan dari riwayat.
- Riwayat lama tanpa arah ditulis **Matched**, bukan ditebak sebagai BUY/SELL.
  Tanpa candle sebelumnya, bukti crossover dinyatakan tidak tersedia, bukan false.
- Data yang sudah terbuang tidak bisa dipulihkan dengan mengubah label atau
  memakai rule terbaru. Jalankan ulang untuk mendapat hasil baru yang lengkap.
- Alasan hasil mengikuti AND/OR; cooldown dibedakan dari kondisi yang false.
- Label harga/CSV mengikuti `manifest.currency`: IDX/IDR atau US/USD, tanpa FX.

WebSocket 403 sebelumnya berbeda lagi: backend mengizinkan origin 5174, sementara
browser memakai 5175. Data/indikator/grant/ticket dapat berhasil tetapi koneksi
ditolak sebelum evaluator bekerja. Daftar origin lokal sudah diperbaiki secara
eksplisit; bukan dengan mematikan autentikasi atau memakai wildcard.

## 5. File yang dibaca saat menjelaskan ke dosen

| Tahap | Source |
| --- | --- |
| Orkestrasi dataset → worker → grant/ticket → hasil | `frontend/web/src/analysis/screener.ts`, `screener-engine.ts`, `screener-socket.ts` |
| Route Gin dan pengecualian raw WebSocket | `backend/internal/api/routes.go`, `backend/internal/platform/http/router.go` |
| Pemeriksaan ticket/izin dan pemetaan respons | `backend/internal/api/screener/websocket_handler.go` |
| Isolasi evaluasi per saham | `backend/internal/screener/decision.go` — `EvaluateBatch` |
| AND/OR, crossover, cooldown dan arah sinyal | `backend/core/engine.go` — `EvaluateDecision`, `evaluateRule`, `evaluateCondition` |
| Data rule dan keputusan | `backend/core/rules.go` |
| Penyimpanan riwayat tanpa menebak arah | `frontend/web/src/lib/market-monitor.ts` |
| Label/alasan dan bukti dua candle | `frontend/web/src/lib/workspace-feedback.ts` |
| Tabel, detail, CSV | `frontend/web/src/pages/workspace-screener-panel.tsx` |

`core` tidak mengenal HTTP, database, akun, atau broker. Handler mengurus boundary
akses/protokol, service mengelompokkan pekerjaan, core mengerjakan matematika,
repository menyimpan resource. Pembagian ini menjaga penjelasan dan pengujian
tetap terpisah.
