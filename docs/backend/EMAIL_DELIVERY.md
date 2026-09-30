# Email authentication (Supabase + Mailtrap)

SignalGen tidak menyimpan SMTP username/password di Git. Supabase Auth tetap
membuat email konfirmasi dan reset password; Mailtrap hanya menjadi pengirim.

## Development dengan Mailtrap Sandbox

1. Buka Mailtrap, pilih **Email Testing > Inboxes**, lalu buka inbox proyek.
2. Salin host, port, username, dan password SMTP dari tab integrasi.
3. Di Supabase Dashboard buka **Authentication > Emails > SMTP Settings**.
4. Aktifkan custom SMTP dan isi sender name/address, host, port, username, dan
   password langsung di Dashboard.
5. Di **Authentication > URL Configuration**, pastikan Site URL dan Redirect
   URLs mengarah ke frontend lokal yang benar.
6. Di **Authentication > Rate Limits**, tetapkan batas email yang sesuai untuk
   pengujian, lalu uji register dan forgot-password dengan akun nonproduksi.

Mailtrap Sandbox menangkap email untuk pengujian; email tidak dikirim ke inbox
pengguna sebenarnya. Saat staging/production, ganti dengan sending domain dan
SMTP production yang telah diverifikasi. Jangan menyalin credential Mailtrap ke
`.env.example`, Postman collection, dokumentasi, commit, atau frontend.
