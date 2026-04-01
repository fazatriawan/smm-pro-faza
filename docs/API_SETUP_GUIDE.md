# Panduan Setup API — SMM Pro
## Integrasi Official API 5 Platform

---

## 1. YOUTUBE (Google API)

### Langkah Setup
1. Buka https://console.cloud.google.com
2. Buat project baru → "SMM Pro"
3. Masuk ke **APIs & Services** → **Library**
4. Cari dan aktifkan: **YouTube Data API v3**
5. Buka **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
6. Application type: **Web Application**
7. Authorized redirect URIs: `http://localhost:5000/api/auth/youtube/callback`
8. Salin **Client ID** dan **Client Secret** ke `.env`

### OAuth Scopes yang Diperlukan
```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/youtube
```

### Rate Limits (Quota Units per Hari)
| Aksi | Quota Cost |
|------|-----------|
| Video upload | 1600 units |
| Search | 100 units |
| Channel info | 1 unit |
| Total default | 10,000 units/hari |

### Cara Minta Peningkatan Quota
- Buka: Console → YouTube Data API → Quotas
- Klik "Request Quota Increase"
- Isi form justifikasi penggunaan

---

## 2. INSTAGRAM & FACEBOOK (Meta Graph API)

### Langkah Setup
1. Buka https://developers.facebook.com
2. Klik **My Apps** → **Create App**
3. Pilih type: **Business**
4. Tambahkan produk: **Instagram Graph API** dan **Facebook Login**
5. Masuk ke **Settings** → **Basic** → salin App ID & App Secret

### Konfigurasi Instagram
- Akun Instagram HARUS berupa **Professional Account** (Creator atau Business)
- Hubungkan ke Facebook Page
- Di App Dashboard → Instagram → **API Setup**

### Permissions yang Harus Diminta (App Review)
```
instagram_basic
instagram_content_publish
instagram_manage_comments
instagram_manage_insights
pages_manage_posts
pages_read_engagement
pages_show_list
```

⚠️ Permissions di atas butuh **App Review** dari Meta (proses 3-7 hari kerja) untuk akun production. Untuk development, gunakan akun test.

### Rate Limits
| Endpoint | Limit |
|----------|-------|
| Content publishing | 25 posts/24 jam per akun |
| API calls | 200 calls/jam per user token |

### Cara Mendapatkan Long-lived Token
```bash
# Exchange short-lived token (60 menit) ke long-lived (60 hari)
GET https://graph.facebook.com/v18.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={APP_ID}
  &client_secret={APP_SECRET}
  &fb_exchange_token={SHORT_LIVED_TOKEN}
```

---

## 3. X / TWITTER

### Langkah Setup
1. Buka https://developer.twitter.com/en/portal/dashboard
2. Klik **Create Project** → beri nama
3. Pilih use case: **Making a bot** atau **Building a tool**
4. Buat **App** di dalam project
5. Masuk ke **Keys and Tokens** → salin Client ID & Client Secret
6. Di **User Authentication Settings**:
   - Aktifkan **OAuth 2.0**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI: `http://localhost:5000/api/auth/twitter/callback`

### OAuth 2.0 Scopes
```
tweet.read
tweet.write
users.read
follows.read
follows.write
like.read
like.write
offline.access
```

### Rate Limits (per 15 menit)
| Endpoint | Limit |
|----------|-------|
| POST /tweets | 17 tweets/15 menit (Free tier) |
| POST /users/:id/likes | 1000/24 jam |
| GET /users/:id/timelines | 180/15 menit |

### Tier yang Direkomendasikan
Untuk 25 akun posting harian → **Basic tier ($100/bulan)**
- 3,000 tweets/bulan per app (write)
- Unlimited reads

---

## 4. TIKTOK

### Langkah Setup
1. Buka https://developers.tiktok.com
2. Klik **Manage Apps** → **Create App**
3. Isi informasi aplikasi
4. Di **Products**, tambahkan:
   - **Login Kit** (untuk OAuth)
   - **Content Posting API**
   - **Display API**
5. Set Redirect URI: `http://localhost:5000/api/auth/tiktok/callback`
6. Submit untuk review (biasanya 3-5 hari)

### Scopes
```
user.info.basic
video.upload
video.list
video.publish
```

### Rate Limits
| Endpoint | Limit |
|----------|-------|
| Video upload init | 1000/hari per app |
| Video publish | Sesuai creator limit akun |

### Alur Upload Video
```
1. POST /v2/post/publish/video/init/   → Dapatkan upload_url
2. PUT upload_url (binary video)        → Upload file
3. Status check hingga video selesai diproses
```

---

## 5. DOCKER COMPOSE (Deployment Mudah)

```yaml
# docker-compose.yml
version: '3.8'
services:
  mongodb:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: secretpassword

  backend:
    build: ./backend
    ports:
      - "5000:5000"
    env_file: ./backend/.env
    depends_on:
      - mongodb
    volumes:
      - ./backend/uploads:/app/uploads

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://localhost:5000/api
      REACT_APP_WS_URL: http://localhost:5000

volumes:
  mongo_data:
```

---

## RINGKASAN BIAYA BULANAN (Estimasi)

| Platform | Plan | Biaya |
|----------|------|-------|
| YouTube API | Gratis (10K quota/hari) | $0 |
| Meta (IG + FB) | Gratis (dengan App Review) | $0 |
| X/Twitter | Basic tier | ~$100/bln |
| TikTok | Gratis (dengan review) | $0 |
| MongoDB Atlas | M10 cluster (25 users) | ~$57/bln |
| VPS/Server | 4 vCPU, 8GB RAM | ~$40/bln |
| **Total** | | **~$197/bln** |

---

## TIMELINE PENGEMBANGAN YANG DISARANKAN

| Fase | Durasi | Fokus |
|------|--------|-------|
| 1 | Minggu 1-2 | Setup project, DB, auth, koneksi akun |
| 2 | Minggu 3-4 | Bulk post + scheduler (tanpa warm up dulu) |
| 3 | Minggu 5-6 | Analytics + notifikasi real-time |
| 4 | Minggu 7-8 | Amplifikasi + warm up + testing |
| 5 | Minggu 9 | Deployment, monitoring, bug fix |
