# Desain Hybrid Screener SignalGen

Status: **vertical slice Model A sudah terimplementasi untuk eksperimen**, tetapi
pilihan arsitektur final tetap perlu dibahas dengan pembimbing.
Tanggal: 27 September 2026.
Acuan: arahan bimbingan terbaru, kode Go/WASM saat ini, dan POC frontend.

## 1. Masalah yang sedang diselesaikan

Targetnya bukan memindahkan semua proses ke server atau semua proses ke browser.
Komputasi berat harus dominan di perangkat pengguna agar server tetap ringan, tetapi
bagian keputusan yang penting tidak boleh seluruhnya tertanam di WASM karena WASM
dapat dibaca dan dimodifikasi oleh pengguna yang menguasai perangkatnya.

Kondisi kode sekarang:

- Go/WASM sudah dapat menghitung EMA9, EMA20, RSI14, dan seluruh rule sinyal.
- Karena seluruh rule berada di `backend/core/engine.go`, orang yang membedah WASM
  dapat mengetahui dan mengubah logika keputusan.
- Frontend POC sudah mengarah ke model hybrid dan mengharapkan socket ticket serta
  pesan `screener.evaluate`.
- Go API sudah memiliki endpoint socket ticket sekali pakai dan WebSocket private
  scoring sebagai vertical slice eksperimen Model A.

Jadi pekerjaan berikutnya adalah memilih batas pemisahan yang tepat, membuktikan
biaya dan keamanannya, lalu baru mengimplementasikan model yang disetujui.

## 2. Gambaran paling sederhana

```text
Data OHLCV satu kali
       |
       v
Browser Web Worker + Go/WASM
  menghitung indikator yang berat
       |
       | feature vector kecil (bukan seluruh candle)
       v
WebSocket backend
  memeriksa akses + menjalankan decision kernel privat
       |
       v
Hasil MATCH / NO_MATCH + reason code
```

Analogi: WASM adalah staf yang menghitung semua angka di lembar kerja. Backend
adalah supervisor yang menyimpan rumus keputusan terakhir. Staf mengirim beberapa
angka ringkas, bukan seluruh lembar kerja, lalu supervisor menjawab hasilnya.

## 3. Tiga model yang harus dibandingkan

### Model A — decision kernel di server (rekomendasi awal)

WASM menghitung fitur seperti harga, EMA, RSI, kemiringan, atau jarak antargaris.
Server menyimpan threshold, kombinasi kondisi, dan keputusan akhir.

Kelebihan:

- komputasi berat tetap di client;
- rule akhir tidak ikut dibagikan bersama WASM;
- payload kecil dan server hanya melakukan beberapa perbandingan;
- paling dekat dengan arahan pembimbing dan POC frontend saat ini.

Kekurangan:

- pengguna dapat memalsukan feature vector karena browser tidak terpercaya;
- koneksi server tetap dibutuhkan untuk setiap evaluasi yang dipilih;
- bila dikirim per candle, jumlah query dapat membesar.

Mitigasi: kirim satu batch kandidat per satu proses screening, bukan satu pesan per
candle. Batasi jumlah kandidat dan ukuran payload.

### Model B — satu indikator kritis dihitung di server

WASM menghitung mayoritas indikator, sedangkan server menghitung satu indikator
atau transformasi rahasia dari data ringkas.

Kelebihan: bagian penting tidak tersedia di WASM dan hasil lebih sulit ditiru.

Kekurangan: server membutuhkan lebih banyak data dan CPU; definisi indikator
rahasia mungkin tetap dapat ditebak dari pasangan input-output; risiko duplikasi
implementasi client/server lebih tinggi.

### Model C — server mengirim rule fragment sementara

Server mengirim parameter/rule berumur pendek, lalu WASM menjalankan semuanya.

Kelebihan: server sangat ringan dan aplikasi dapat menyelesaikan batch secara lokal.

Kekurangan: parameter sudah berada di perangkat pengguna dan dapat direkam. Ini
hanya obfuscation sementara, bukan perlindungan logika yang kuat.

### Kesimpulan sementara

Model A menjadi kandidat eksperimen pertama. Ini **belum keputusan final**. Model A
dan B perlu dibandingkan dengan fixture yang sama sebelum dibawa ke pembimbing.
Model C cukup menjadi pembanding untuk menunjukkan mengapa rule yang dikirim ke
client tidak benar-benar privat.

Hasil microbenchmark pertama Model A/B dicatat di
[`SPLIT_MODEL_EXPERIMENT.md`](SPLIT_MODEL_EXPERIMENT.md).

## 4. Batas tanggung jawab yang diusulkan

### Client/WASM

- memvalidasi dan membaca dataset;
- menghitung indikator dan fitur numerik yang berat;
- memilih kandidat yang layak dikirim agar request tidak terlalu sering;
- mengirim feature vector dalam satu batch;
- menampilkan hasil dan alasan yang aman untuk pengguna;
- tidak menentukan entitlement, role, atau status akun.

### Backend

- memverifikasi bearer token, app session, device, dan entitlement;
- menerbitkan socket ticket sekali pakai dengan TTL pendek;
- mengikat ticket ke user, session, compute grant, dan versi engine/rule;
- menjalankan decision kernel kecil;
- mengembalikan keputusan dan reason code yang tidak membuka seluruh formula;
- melakukan rate limit dan audit tanpa mencatat token atau feature mentah sensitif.

## 5. Alur satu proses screening

1. Pengguna login dan membuat app session.
2. Client meminta dataset dan compute grant yang sudah terikat ke user, rule,
   dataset, checksum, serta versi engine.
3. Worker/WASM menghitung indikator secara lokal.
4. Client meminta `POST /api/v1/screener/socket-tickets` dengan compute grant.
5. Backend memberi ticket acak, sekali pakai, dan berumur sangat pendek.
6. Client membentuk URL dari `websocket_path` lalu membuka
   `wss://.../api/v1/screener/ws?ticket=...`. Query string harus disensor dari log.
7. Client mengirim satu pesan `screener.evaluate` berisi batch feature vector.
8. Backend mengonsumsi ticket, memvalidasi semua binding, dan menilai batch.
9. Backend mengirim `screener.result`, kemudian koneksi dapat ditutup.

Ticket tidak boleh dikirim sebagai bearer token, tidak boleh dapat digunakan dua
kali, dan tidak boleh berlaku untuk user/session/grant lain.

## 6. Kontrak pesan yang diusulkan

Schema mesin tersedia di [`backend/contracts/hybrid-screener.schema.json`](../../backend/contracts/hybrid-screener.schema.json).

Contoh permintaan ticket:

```json
{
  "compute_grant_id": "cgr_0123456789abcdef01234567",
  "protocol": "screener-private-1"
}
```

Contoh pesan client:

```json
{
  "type": "screener.evaluate",
  "protocol": "screener-private-1",
  "request_id": "scr_0123456789abcdef01234567",
  "engine_version": "core-0.3.0",
  "feature_schema_version": "screener-features-1",
  "candidates": [
    {
      "symbol": "BBCA.JK",
      "timestamp": "2026-02-07T00:00:00Z",
      "features": {
        "price": 128,
        "ema9": 125.215963484,
        "ema20": 121.299378776,
        "rsi14": 72.771414437
      }
    }
  ]
}
```

Contoh hasil:

```json
{
  "type": "screener.result",
  "protocol": "screener-private-1",
  "request_id": "scr_0123456789abcdef01234567",
  "decision_version": "decision-1",
  "results": [
    {
      "symbol": "BBCA.JK",
      "timestamp": "2026-02-07T00:00:00Z",
      "matched": true,
      "reason_codes": ["TREND_CONFIRMED", "MOMENTUM_ALLOWED"]
    }
  ]
}
```

Reason code menjelaskan kategori hasil kepada UI tanpa harus membocorkan threshold
dan seluruh kombinasi rule privat.

### Catatan integrasi frontend

POC pada branch `frontend-website` saat ini memakai bentuk feature yang berbeda:
`rsi`, `ema_fast`, `ema_slow`, `volume_ratio`, dan `atr_ratio`, serta hanya mengirim
satu feature terbaru. Baseline backend yang sudah memiliki golden fixture baru
membuktikan `price`, `ema9`, `ema20`, dan `rsi14` untuk rangkaian kandidat.

Perbedaan ini sengaja belum “disamakan” dengan tebakan. Formula periode EMA, ATR,
volume ratio, jumlah kandidat, dan timestamp harus dibekukan bersama FE sebelum
integrasi. Sampai keputusan itu ada, schema di dokumen ini adalah kontrak eksperimen
backend yang mengikuti baseline terverifikasi, bukan bukti POC frontend sudah cocok.

## 7. Threat model dan batas kejujuran

- WASM bukan DRM; pengguna tetap dapat membedah binary dan mengubah JavaScript.
- Feature vector berasal dari client sehingga dapat dipalsukan. Hasil private
  scoring cocok untuk alur aplikasi terkontrol, tetapi bukan bukti transaksi nyata,
  billing, atau kompetisi yang membutuhkan integritas tinggi.
- Enkripsi dataset melindungi data saat tersimpan/ditransfer, bukan saat plaintext
  sedang dipakai client.
- Socket ticket mengurangi replay dan penyalahgunaan koneksi, tetapi tidak membuat
  perangkat pengguna menjadi trusted.
- Untuk kompetisi masa depan, data dan waktu transaksi perlu ditentukan server dari
  feed real-time; jangan memakai hasil client sebagai sumber authoritative.

## 8. Identitas perangkat

Browser biasa tidak dapat membaca MAC address secara aman dan portable. Usulan MVP:

- `installation_id`: UUID acak yang persisten di browser;
- app session opaque dari server;
- user agent family/label hanya metadata;
- IP yang dilihat server menjadi sinyal risiko, bukan identitas utama;
- maksimum satu perangkat aktif dalam satu waktu;
- perpindahan perangkat maksimum sekali dalam jendela 24 jam.

Kebijakan perpindahan 24 jam sudah ditegakkan dalam transaksi database sehingga dua
login bersamaan tidak dapat melewati pemeriksaan yang sama.
Menghapus storage browser dapat menghasilkan installation ID baru; karena itu server
tetap menegakkan cooldown berdasarkan akun, bukan mempercayai ID dari client saja.

## 9. Batas deployment vertical slice

Socket ticket dan rate limit saat ini tersimpan di memori proses. Ini sesuai untuk
satu instance pada eksperimen lokal, tetapi belum aman untuk deployment multi-instance:
instance lain tidak dapat menemukan ticket yang diterbitkan instance pertama. Sebelum
scale-out, gunakan shared store (misalnya Redis) atau sticky routing yang tervalidasi.

## 10. Eksperimen sebelum keputusan final

Gunakan dataset, kandidat, dan hasil expected yang sama untuk semua model.

| Yang diukur | Cara ukur |
| --- | --- |
| Correctness | hasil Model A/B sama dengan baseline beku |
| Beban server | CPU, RAM, waktu proses, jumlah pesan untuk 1/10/30 sesi |
| Network | total request, payload masuk/keluar, p50/p95 latency |
| Perlindungan | bagian formula yang masih terlihat di bundle/WASM/pesan |
| Failure | offline, ticket expired/replay, session revoked, payload berlebih |

Kriteria awal untuk Model A: satu koneksi/pesan batch per run; tidak mengirim OHLCV;
payload dibatasi; hasil parity; server jauh lebih ringan daripada menjalankan seluruh
screener; replay dan binding yang salah ditolak.

## 11. Status implementasi dan langkah lanjutan

1. Selesai — schema feature vector dan expected result dibekukan dari fixture.
2. Selesai — `compute features` dipisah dari `evaluate decision` dengan parity test.
3. Selesai — decision kernel server memiliki unit test tanpa WebSocket.
4. Selesai — ticket sekali pakai memiliki TTL dan binding lengkap.
5. Selesai — endpoint ticket dan WebSocket memiliki size/candidate/time limit.
6. Selesai untuk microbenchmark — prototipe Model B dibandingkan dengan Model A.
7. Berikutnya — sepakati formula feature bersama frontend, lalu integrasikan POC.
8. Berikutnya — jalankan load test 1/10/30 sesi dan ukur p50/p95.
9. Berikutnya — bawa hasil ke pembimbing untuk memilih model final.

Yang sengaja belum dikerjakan pada tahap ini: kompetisi, real-time trading simulation,
payment, NAV/NAB kompleks, banyak data source, dan redesign UI.

## 12. Checklist belajar

Setelah membaca dokumen ini, pastikan kamu bisa menjawab:

- Mengapa indikator berat dihitung di WASM tetapi keputusan akhir di server?
- Mengapa WebSocket dipakai untuk pesan ringkas, bukan mengirim seluruh dataset?
- Apa bedanya bearer token, app session, compute grant, dan socket ticket?
- Mengapa MAC address bukan pilihan yang realistis untuk aplikasi web?
- Mengapa hasil dari feature client belum cukup aman untuk kompetisi?
- Data apa yang perlu dibawa saat membandingkan Model A dan Model B?
