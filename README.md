# SMM Pro — Social Media Manager
### Kelola 25 akun × 5 platform dari satu dashboard

---

## Fitur Utama

| Fitur | Deskripsi |
|-------|-----------|
| **Bulk Post** | Posting konten yang sama ke semua platform & akun sekaligus |
| **Scheduler** | Jadwalkan post harian dengan template jam otomatis |
| **Amplifikasi** | Koordinasikan like, komentar, share, repost, save dari banyak akun |
| **Warm Up** | Aktivitas organik terkontrol (like, follow, search, save) |
| **Notifikasi** | Semua notif dari semua platform di satu tempat, real-time |
| **Analytics** | Statistik lengkap per platform, per akun, per konten |
| **Caption Optimization** | Optimasi caption otomatis per platform (TikTok, Instagram, YouTube, LinkedIn, Twitter, Facebook) |
| **Schedule Strategy** | Jadwal posting optimal berdasarkan best posting times per platform |
| **Analytics Enhancement** | Engagement rate, performance report, top content, rekomendasi strategi konten |

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Frontend | React 18, React Router, Zustand, React Query, Recharts |
| Backend | Node.js, Express, Socket.io |
| Database | MongoDB + Mongoose |
| Scheduler | node-cron |
| Auth | JWT (JSON Web Token) |

---

## Struktur Project

```
smm-pro/
├── frontend/
│   └── src/
│       ├── api/          — Axios API client
│       ├── components/   — Layout, shared components
│       ├── hooks/        — useSocket, dll
│       ├── pages/        — Semua halaman utama
│       ├── store/        — Zustand global state
│       └── utils/        — Helpers, PlatformPill, dll
├── backend/
│   └── src/
│       ├── models/       — MongoDB schemas (User, Post, dll)
│       ├── routes/       — API endpoints
│       ├── services/     — publishService, schedulerService, dll
│       └── middleware/   — JWT auth middleware
└── docs/
    └── API_SETUP_GUIDE.md  — Panduan setup API tiap platform
```

---

## Cara Menjalankan

### 1. Persiapan Database
```bash
# Install MongoDB lokal, atau gunakan MongoDB Atlas
# Salin .env.example ke .env dan isi semua variabel
cd backend
cp .env.example .env
```

### 2. Jalankan Backend
```bash
cd backend
npm install
npm run dev          # http://localhost:5000
```

### 3. Jalankan Frontend
```bash
cd frontend
npm install
npm start            # http://localhost:3000
```

### 4. Buat Admin Pertama
```bash
# POST http://localhost:5000/api/auth/register
{
  "name": "Admin",
  "email": "admin@brand.com",
  "password": "password123",
  "role": "admin"
}
```

---

## API Endpoints

### Auth
```
POST /api/auth/register    — Daftar user baru
POST /api/auth/login       — Login, dapat JWT token
GET  /api/auth/me          — Data user saat ini
```

### Akun Sosial
```
GET    /api/accounts          — List semua akun
POST   /api/accounts          — Tambah akun baru (setelah OAuth)
PATCH  /api/accounts/:id/warmup — Update setting warm up
DELETE /api/accounts/:id      — Putus koneksi akun
```

### Post
```
GET    /api/posts             — List post (dengan pagination)
POST   /api/posts             — Buat post bulk baru
GET    /api/posts/:id         — Detail satu post
DELETE /api/posts/:id         — Hapus post
```

### Scheduler
```
GET   /api/schedule           — Post yang terjadwal
PATCH /api/schedule/:id       — Reschedule post
```

### Notifikasi
```
GET   /api/notifications          — Semua notifikasi
PATCH /api/notifications/:id/read — Tandai dibaca
PATCH /api/notifications/mark-all-read
```

### Analytics
```
GET /api/analytics/summary        — Ringkasan semua akun
GET /api/analytics/account/:id    — Time-series satu akun
GET /api/analytics/engagement-rate/:postId — Engagement rate satu post
GET /api/analytics/performance-report      — Laporan performa (query: accountId, startDate, endDate)
GET /api/analytics/top-content             — Top performing content (query: accountId, limit)
GET /api/analytics/content-suggestions     — Rekomendasi strategi konten (query: accountId)
```

### Amplifikasi
```
GET  /api/amplify    — List job amplifikasi
POST /api/amplify    — Buat & jalankan job baru
```

### Warm Up
```
GET /api/warmup/stats   — Statistik hari ini
GET /api/warmup/logs    — Log aktivitas
```

### Caption Optimization
```
POST /api/caption/optimize        — Optimasi caption untuk satu platform
                                    Body: { caption, platform }
POST /api/caption/optimize-batch  — Optimasi caption untuk semua platform sekaligus
                                    Body: { caption, platforms[] }
POST /api/caption/hashtags        — Generate hashtag
                                    Body: { content, platform, count }
```

### Schedule Strategy
```
GET  /api/schedule-strategy/optimal-time  — Waktu posting optimal
                                            Query: platform, contentType
POST /api/schedule-strategy/weekly        — Generate jadwal mingguan
                                            Body: { platforms[], contentTypes[] }
POST /api/schedule-strategy/batch         — Suggest batch schedule
                                            Body: { videoCount, platforms[] }
```

---

## Real-time Events (Socket.io)

| Event | Arah | Deskripsi |
|-------|------|-----------|
| `notification:new` | Server → Client | Notifikasi baru masuk |
| `post:published` | Server → Client | Post berhasil terkirim |
| `post:failed` | Server → Client | Post gagal dikirim |
| `join` | Client → Server | Join room user |

---

## Catatan Penting

1. **OAuth tokens harus dienkripsi** di database production (gunakan `crypto` atau `bcrypt`)
2. **Upload video** ke YouTube memerlukan resumable upload API untuk file besar
3. **TikTok Content Posting API** butuh approval dari TikTok (submit app review)
4. **Instagram** hanya support Professional Account (bukan personal)
5. **Rate limits** berbeda tiap platform — lihat `docs/API_SETUP_GUIDE.md`

---

## License
Private — untuk penggunaan internal
