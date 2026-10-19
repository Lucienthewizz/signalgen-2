# Cache historis terenkripsi

Keputusan pengguna, 15 Oktober 2026: **IndexedDB terenkripsi, dibersihkan saat
logout**. Scope: payload OHLCV historis / dataset snapshot screener. Bukan perubahan
password, database akun Supabase, rules, jurnal, atau enkripsi seluruh browser.

## Alur nyata

1. Screener memvalidasi sesi, menyiapkan dataset dan membaca rule.
2. `screener-dataset.ts` membaca `/api/auth/me` dan manifest dari server. Sesi,
   ownership dan entitlement tetap diperiksa online, termasuk pada cache hit.
3. Scope: API origin + user ID terverifikasi + installation ID. Cache ID mengikat
   scope, dataset ID, version, schema dan checksum.
4. Hit: dekripsi, dekompresi terbatas, lalu validasi SHA-256/ukuran/schema/simbol/candle.
5. Miss/rusak/expired: unduh lewat shared API client. Checksum memakai **byte respons
   asli**, bukan serialisasi ulang JSON. Data jaringan tidak valid menghentikan run,
   bukan menampilkan `No match`.
6. Data valid dikompresi gzip lalu dienkripsi AES-256-GCM sebelum disimpan.
   Plaintext sementara di RAM dipakai WASM. Jalur private scoring tidak diubah.

Prepare baru membuat ID/version baru. Cache version-exact ini tidak menjanjikan
semua run berikutnya cache hit/lebih cepat; reuse hanya untuk handle/versi sama yang
belum expired dan masih diizinkan server.

## Format, kunci dan batas

- Database khusus `signalgen-historical-cache-v1`: `snapshots`, `keys`, `meta`.
  Tidak menyimpan token, credential, private rule atau raw OHLCV di localStorage.
  Metadata pengikatan/expiry terbaca; isi candle adalah ciphertext.
- AES-256-GCM; IV acak 96 bit baru setiap enkripsi; tag 128 bit. AAD mengikat format,
  scope, dataset/version/schema/checksum/decoded bytes/expiry.
- Key acak per scope berupa non-extractable CryptoKey, usage encrypt/decrypt,
  disimpan lewat structured clone IndexedDB tanpa ekspor raw/JWK. Tidak ada key
  hardcoded/global atau key Supabase baru.
- Format `ohlcv-gzip-aes256gcm-1` versioned. Ini cache data, bukan hasil engine;
  feature vector dari engine lama tidak pernah dipakai ulang oleh cache ini.
- Maksimal 32 entry / 16 MiB ciphertext, raw/decompressed payload maksimal 4 MiB,
  TTL maksimal 15 menit dan tidak melewati expiry server. Pruning pada read/write/
  status; eviction tertua dahulu.

## Lifecycle dan fallback

Login baru, user switch, logout, auth invalid dan session revoked memakai jalur
cleanup yang sama: invalidasi generation segera, hentikan worker, batalkan run/
socket continuation, lalu hapus snapshot + key dalam transaksi. Epoch database
mencegah write lama muncul lagi setelah clear. Storage event non-rahasia memberi
tahu tab lain. Token refresh dalam login sama tidak merotasi scope/key.

Tombol **Hapus cache** di halaman akses menghapus snapshot + key sungguhan; angka
status berasal dari IndexedDB, bukan sample. Tidak menghapus jurnal/preferensi/
legacy. Cache disposable, bukan sumber authoritative.

IndexedDB/quota/clone CryptoKey gagal: pakai data jaringan terverifikasi di memori
untuk run itu, **tidak pernah fallback menyimpan plaintext**. Bila akses storage
ditolak, penghapusan tidak dapat dijamin aplikasi; tombol/status melaporkan gagal.
Tutup tab lain dan ulangi, atau hapus site data di pengaturan browser. Tidak ada
offline authorization.

## Batas keamanan untuk laporan asis

Ini **enkripsi cache browser at rest**, bukan E2E/DRM. Non-extractable mengurangi
ekspor key tidak sengaja, bukan melindungi dari XSS, extension berbahaya, pemilik
browser/DevTools atau kompromi penuh profil/perangkat. Script origin yang sama
masih bisa meminta dekripsi.

Plaintext diperlukan untuk RSI/EMA. Buffer byte sementara diisi nol setelah
digunakan dan worker dihentikan saat cleanup, tetapi string/objek JS/GC tidak
menjamin secure memory wipe. Cache provider/snapshot backend masih RAM seperti
sebelumnya, bukan database OHLCV terenkripsi baru di Supabase.

**Production tetap wajib HTTPS/WSS**; loopback HTTP/WS development bukan TLS.
SHA-256 adalah integritas, bukan kerahasiaan. Manifest melalui koneksi yang bisa
dimanipulasi juga bukan bukti keaslian. Fitur ini tidak memasang sertifikat/domain/
proxy production atau mengubah enkripsi database Supabase. History UI ringkas,
preferensi dan auth storage lama tidak otomatis terenkripsi; audit XSS/CSP dan
auth storage merupakan pekerjaan terpisah.

Referensi: [AES-GCM, MDN](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams),
[CryptoKey storage, MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto#storing_keys),
[client storage/XSS, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).

## Verifikasi

`npm test`: round-trip, non-extractable key, IV baru, tamper data/tag/AAD, isolasi
owner/instalasi/API/version/schema/checksum, expiry, checksum jaringan, quota/denied,
logout saat download/key generation dan online denial. Tes browser CLI memakai data
sintetis dan IndexedDB/Web Crypto asli, bukan bukti akun/cloud production.
