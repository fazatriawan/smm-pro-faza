# SMM Telegram Bridge

Headless 24/7 microservice: **Telegram Bot** → **Google Drive** (bank konten) → **Gemini** (caption) → **Outstand** (bulk publish) → **Express webhook** → **Google Sheets** (laporan link live).

Tidak ada UI web. Dikontrol sepenuhnya dari Telegram di HP Anda.

## Arsitektur

```
/publish (Telegram)
    → Drive: list sub-folder → pilih folder → list media
    → Gemini: caption + hashtag
    → Pilih gaya caption (informatif / viral / formal)
    → [Preview | Send Now | Schedule | Edit Caption]
    → Outstand: upload media → POST /v1/posts (multi-akun per platform)

Outstand webhook POST /webhook/outstand
    → Google Sheets (tab per hari): Timestamp | Post ID | … | FB @/Link | IG @/Link | …
    → Notifikasi Telegram (live / gagal)
```

## Fitur bot (v2)

- **Menu tombol**: Publish, Laporan Sheets, Batal, Bantuan
- **Multi-akun**: centang beberapa akun per platform, atau lintas platform (`Pilih beberapa`)
- **Gambar → video**: IG / Threads / FB / YouTube dengan musik (`assets/audio/`) atau silent; **carousel** jika banyak gambar
- **YouTube**: judul & deskripsi terpisah (Gemini `TITLE:` / `DESCRIPTION:`)
- **Jadwal mudah**: `+3 jam`, `besok 09:00`, `21/05 14:30`, atau ISO
- **Preview + validasi** sebelum publish (ffmpeg / musik)
- **`/status`**: cek Post ID Outstand
- **`/kuota`**: kuota upload hari ini + perkiraan sesi batch tersisa (`/random ig 25`, dll.)
- **`/republish`**: media + caption sama, target baru
- **`/retry`**: publish ulang hanya akun yang *gagal* (media & caption sama)
- **Ringkasan harian** ke Telegram (jam `DAILY_SUMMARY_HOUR`, TZ `Asia/Jakarta`)
- **Misi harian**: forward broadcast SONAR → bot baca §1, §2, §5 (+ link Drive di §5)
- **Media langsung**: kirim foto/video ke chat (tanpa Drive)

## Persyaratan

- Node.js 18+
- VPS dengan HTTPS untuk webhook (nginx/Caddy + domain)
- Akun [Outstand](https://www.outstand.so) + API key + ~225 social accounts terhubung
- Google Cloud project + Service Account
- Bot Telegram via [@BotFather](https://t.me/BotFather)

## Instalasi cepat

```bash
cd telegram-bridge
cp .env.example .env
# isi semua variabel di .env
npm install
npm start
```

Production dengan PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 logs smm-telegram-bridge
```

## Environment variables

| Variabel | Wajib | Keterangan |
|----------|-------|------------|
| `PORT` | | Port Express (default `3000`) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token dari BotFather |
| `OUTSTAND_API_KEY` | ✅ | Bearer token Outstand |
| `GEMINI_API_KEY` | ✅ | **Sama dengan `backend/.env`** — sudah dipakai SMM Pro (AI caption, amplify, desktop) |
| `GOOGLE_SPREADSHEET_ID` | ✅ | ID spreadsheet laporan |
| `GOOGLE_DRIVE_FOLDER_ID` | ✅ | ID folder root *bank konten* |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | | Path JSON SA (default Windows: `C:/projects/spreadsheet-analyzer/service_account.json`) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | | Alias sama seperti di spreadsheet-analyzer |
| `TELEGRAM_ALLOWED_CHAT_IDS` | | Batasi chat ID (pisah koma) |
| `OUTSTAND_WEBHOOK_SECRET` | | HMAC secret dari Outstand webhook settings |
| `GOOGLE_SHEET_TAB` | | Nama tab sheet (default `Sheet1`) |
| `OUTSTAND_ACCOUNT_BATCH_SIZE` | | Akun per request POST (default `50`) |
| `IMAGE_TO_VIDEO_*` | | Gambar→video: audio, durasi, platform, silent |
| `IMAGE_TO_VIDEO_DURATION_BY_NETWORK` | | JSON durasi per platform, mis. `{"youtube":30}` |
| `FFMPEG_PATH` | | Path ffmpeg jika tidak di PATH |
| `MAX_DRIVE_FILE_MB` | | Peringatan ukuran file (0 = nonaktif) |
| `DAILY_SUMMARY_ENABLED` | | Ringkasan Sheets ke Telegram (default on) |
| `DAILY_SUMMARY_HOUR` | | Jam kirim ringkasan (0–23, default `22`) |

## Setup Google Service Account

### 1. Buat project & service account

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat project baru (atau pakai yang ada).
3. **APIs & Services → Library** → aktifkan:
   - **Google Drive API**
   - **Google Sheets API**
4. **APIs & Services → Credentials → Create Credentials → Service account**.
5. Buat key **JSON** → unduh file.
6. Simpan JSON service account (jangan di-commit).

**Proyek ini sudah dikonfigurasi memakai kredensial yang sama dengan `spreadsheet-analyzer`:**

`C:\projects\spreadsheet-analyzer\service_account.json`

Cukup pastikan file itu ada. Override lewat `GOOGLE_SERVICE_ACCOUNT_PATH` atau `GOOGLE_SERVICE_ACCOUNT_FILE` di `.env` jika perlu path lain.

### 2. Beri akses ke Drive & Spreadsheet

Service account punya email seperti:

`your-sa@your-project.iam.gserviceaccount.com`

1. **Google Drive**: buka folder bank konten (`GOOGLE_DRIVE_FOLDER_ID`) → Share → tambahkan email service account sebagai **Viewer** (cukup untuk baca media). Untuk Shared Drive, pastikan "Viewer" di level drive/folder.
2. **Google Sheets**: buka spreadsheet laporan → Share → tambahkan email yang sama sebagai **Editor** (agar bisa append baris).

### 3. Siapkan spreadsheet

**Spreadsheet contoh:** `GOOGLE_SPREADSHEET_ID=1upvIUPf8M-YBwy6UcsrFtszIFT2iDwpLGcAdYIc0ofA`

- **Tab baru otomatis per tanggal** (nama tab: `YYYY-MM-DD`, timezone `TZ`, default Asia/Jakarta)
- **Kolom per platform** (satu baris per post publish):

| Timestamp | Post ID | Instagram | Threads | YouTube | Facebook | LinkedIn | Pinterest | Bluesky | X (Twitter) | TikTok |

Isi sel platform: `@username` + baris baru + link live. Beberapa akun di platform sama digabung dalam satu sel.

Webhook akan menulis ke tab **tanggal hari itu** saja.

### 4. Google Drive — Anda kirim link yang diterima

Anda **tidak perlu** set folder di `.env`. Alur:

1. Tim mengirim link folder Drive (Anda forward ke bot)
2. `/publish` → paste link (atau langsung paste link tanpa `/publish`)
3. Bot menampilkan **sub-folder / file** di dalam link → Anda pilih
4. Caption AI → Publish

Bot memakai **Drive API** (bukan menyimpan link). Link boleh ganti setiap hari — cukup paste yang baru.

**Akses wajib:** pengirim link harus **share folder** ke email service account (`client_email` di `service_account.json`) sebagai Viewer. Tanpa ini bot tidak bisa membaca isi folder.

### 5. Google Sheets (otomatis)

`GOOGLE_SPREADSHEET_ID` **boleh dikosongkan**. Saat startup, bot membuat spreadsheet baru + header, menyimpan ID di `data/runtime.json`.

- `/sheet` di Telegram → tampilkan link
- Opsional: `GOOGLE_SHEET_SHARE_EMAIL=you@gmail.com` agar sheet di-share ke email Anda

**Layout tab harian** (satu baris = satu akun; kolom **per platform**):

| Timestamp | Post ID | Judul YouTube | Status | Catatan | Facebook @ | Facebook Link | Instagram @ | Instagram Link | Threads @ | … |

Baris Facebook hanya isi kolom Facebook; baris Instagram hanya kolom Instagram (diurutkan FB → IG → Threads → YT). Jalankan **`/synctoday`** untuk perbarui header + tulis ulang tab hari ini.

### Kuota YouTube (upload harian)

Publish YouTube lewat Outstand memakai **satu Google Cloud project** milik Outstand (OAuth). **Semua akun YouTube Anda berbagi kuota project itu** — bukan “X upload per akun per hari” dari sisi API.

- Default Google: **10.000 unit/hari per project**. `videos.insert` ≈ **100 unit** (per Des 2025) → teoretis **~100 upload/hari total** untuk seluruh akun di project yang sama.
- Contoh: 144 akun × 1 video = 144 upload → ~14.400 unit → **melebihi default** → banyak yang gagal meski tiap channel masih “boleh” upload.
- Untuk **banyak video per hari per banyak akun**: buat **Google Cloud project sendiri**, hubungkan OAuth (`YOUTUBE_CLIENT_ID` di backend SMM), ajukan [Quota Extension + audit](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) ke Google — atau nego kuota dengan **Outstand** (paket/enterprise).
- Selain kuota API, YouTube juga punya batas **per channel** (`uploadLimitExceeded`) — channel baru/unverified sering dibatasi ~6–15 upload/hari oleh YouTube sendiri.

## Setup Outstand webhook

1. Outstand → **Settings → Webhooks → Add Webhook**
2. **Endpoint URL**: `https://your-domain.com/webhook/outstand`
3. Event: centang **`post.published`**
4. (Opsional) Signing secret → salin ke `OUTSTAND_WEBHOOK_SECRET` di `.env`
5. Test webhook dari dashboard Outstand

Reverse proxy contoh (nginx):

```nginx
location /webhook/outstand {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

Health check: `GET https://your-domain.com/health`

## Perintah Telegram

| Perintah | Fungsi |
|----------|--------|
| `/start` | Bantuan singkat |
| `/publish` | Minta link Drive → pilih konten → caption AI → publish |
| *(paste link)* | Bisa langsung kirim link Drive tanpa perintah |
| `/cancel` | Batalkan sesi |

Setelah caption muncul:

- **🚀 Send Now** — upload media ke Outstand + post ke semua akun (`GET /v1/social-accounts` lalu batch `POST /v1/posts`)
- **📅 Schedule** — kirim tanggal ISO UTC (contoh `2026-05-21T09:00:00Z`)
- **✍️ Edit Caption** — kirim teks caption baru

## Struktur kode

```
telegram-bridge/
├── src/
│   ├── index.js              # Bootstrap Express + Telegraf
│   ├── config/
│   │   ├── env.js
│   │   └── google.js
│   ├── services/
│   │   ├── bot.js            # Telegraf handlers
│   │   ├── drive.js
│   │   ├── ai.js             # Gemini 1.5 Flash
│   │   ├── outstand.js
│   │   └── sheets.js
│   ├── server/
│   │   └── webhook.js
│   └── utils/
│       ├── session.js
│       └── platformUrl.js
├── credentials/              # service-account.json (gitignored)
├── .env.example
├── ecosystem.config.cjs
└── README.md
```

## Alur Outstand API (implementasi)

1. `POST /v1/media/upload` — dapat `upload_url` + `id`
2. `PUT upload_url` — unggah bytes dari Google Drive
3. `POST /v1/media/{id}/confirm`
4. `GET /v1/social-accounts` — semua akun terhubung (bukan hardcode 225)
5. `POST /v1/posts` — `containers`, `socialAccountIds`, opsional `scheduledAt` (di-batch jika > `OUTSTAND_ACCOUNT_BATCH_SIZE`)

Dokumentasi resmi: [https://www.outstand.so/docs](https://www.outstand.so/docs)

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `Service account file not found` | Pastikan path `GOOGLE_SERVICE_ACCOUNT_PATH` benar |
| Folder kosong di Telegram | Pastikan sub-folder berisi file image/video |
| `No social accounts connected` | Hubungkan akun di dashboard Outstand |
| Webhook tidak menulis sheet | Cek share Editor ke SA email; cek log VPS |
| Signature 401 | Samakan `OUTSTAND_WEBHOOK_SECRET` dengan Outstand |
| Gemini kosong | Cek `GEMINI_API_KEY` & kuota API |
| YouTube banyak gagal kuota | Kurangi akun YT per batch; kuota = pool project Outstand (~100 upload/hari default), bukan per akun |
| Sheet link “loncat” kolom | `/synctoday` untuk rapikan tab hari ini |

## Keamanan

- Jangan commit `.env` atau `credentials/*.json`
- Set `TELEGRAM_ALLOWED_CHAT_IDS` di production
- Gunakan HTTPS + webhook signing secret
- VPS: firewall hanya buka 80/443, Node bind localhost di belakang reverse proxy
