# SMM Pro — Social Media Manager Playbook

## Tentang Proyek Ini

SMM Pro adalah Social Media Manager Dashboard untuk mengelola 25+ akun × 5+ platform dari satu tempat.
Proyek ini mengintegrasikan skill **social-publisher** untuk otomasi publishing, optimasi caption,
scheduling cerdas, dan analytics lintas platform.

---

## Kemampuan Utama (Skills)

### 1. Bulk Post
Posting konten yang sama ke semua platform & akun sekaligus.
- Upload sekali, publish ke semua platform
- Override caption per platform
- Upload media ke Cloudinary

### 2. Scheduler
Jadwalkan post dengan template jam otomatis menggunakan `node-cron`.
- Cron job setiap menit untuk memeriksa post terjadwal
- Reschedule via API
- Strategi jadwal optimal per platform

### 3. Amplifikasi
Koordinasikan like, komentar, share, repost, save dari banyak akun.
- Batch execution ke semua akun sekaligus
- Real-time status via Socket.io

### 4. Warm Up
Aktivitas organik terkontrol (like, follow, search, save) untuk meningkatkan reach organik.
- Konfigurasi per akun
- Logging semua aktivitas

### 5. Notifikasi
Semua notif dari semua platform di satu tempat, real-time via Socket.io.

### 6. Analytics
Statistik lengkap per platform, per akun, per konten.
- Cross-platform engagement rate
- Performance report mingguan/bulanan
- Top performing content
- Content strategy suggestions

### 7. Social Publisher Skill *(baru)*
Optimasi konten untuk publishing multi-platform:
- Caption optimization per platform
- Hashtag strategy per platform
- Scheduling strategy dengan best posting times
- Batch schedule generation

---

## Skill: Social Publisher

Lihat panduan lengkap di: [`.github/skills/social-publisher/SKILL.md`](.github/skills/social-publisher/SKILL.md)

### Platform yang Didukung

| Platform  | Tipe Konten          | Caption Style     | Hashtag |
|-----------|----------------------|-------------------|---------|
| TikTok    | Short video          | Casual, trendy    | 3-5     |
| Instagram | Image / Reel         | Engaging, story   | 10-15   |
| YouTube   | Long video / Short   | SEO-optimized     | 3-5     |
| LinkedIn  | Post / Video         | Professional      | 3-5     |
| Twitter/X | Tweet / Thread       | Concise, punchy   | 1-2     |
| Facebook  | Post / Reel          | Conversational    | 1-3     |
| Threads   | Post / Thread        | Casual            | 3-5     |
| Pinterest | Pin / Idea Pin       | Descriptive       | 5-10    |

---

## API Endpoints

### Caption Optimization (baru)
```
POST /api/caption/optimize        — Optimasi caption 1 platform
POST /api/caption/optimize-batch  — Optimasi semua platform sekaligus
POST /api/caption/hashtags        — Generate hashtag per platform
```

### Schedule Strategy (baru)
```
GET  /api/schedule-strategy/optimal-time  — Best posting time per platform
POST /api/schedule-strategy/weekly        — Generate jadwal mingguan
POST /api/schedule-strategy/batch         — Suggest batch schedule
```

### Analytics Enhancement (baru)
```
GET  /api/analytics/engagement-rate/:postId   — Hitung engagement rate
GET  /api/analytics/performance-report         — Laporan performa
GET  /api/analytics/top-content               — Top performing content
GET  /api/analytics/content-suggestions       — Rekomendasi strategi konten
```

### Existing Endpoints
```
# Auth
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me

# Akun Sosial
GET    /api/accounts
POST   /api/accounts
PATCH  /api/accounts/:id/warmup
DELETE /api/accounts/:id

# Posts
GET    /api/posts
POST   /api/posts
GET    /api/posts/:id
POST   /api/posts/:id/stop
POST   /api/posts/:id/retry
DELETE /api/posts/:id

# Scheduler
GET   /api/schedule
PATCH /api/schedule/:id

# Notifikasi
GET   /api/notifications
PATCH /api/notifications/:id/read
PATCH /api/notifications/mark-all-read

# Analytics
GET /api/analytics/summary
GET /api/analytics/account/:id

# Amplifikasi
GET  /api/amplify
POST /api/amplify

# Warm Up
GET /api/warmup/stats
GET /api/warmup/logs
```

---

## Tech Stack

| Layer      | Teknologi                                        |
|------------|--------------------------------------------------|
| Frontend   | React 18, React Router, Zustand, React Query, Recharts |
| Backend    | Node.js, Express, Socket.io                      |
| Database   | MongoDB + Mongoose                               |
| Scheduler  | node-cron                                        |
| Auth       | JWT (JSON Web Token)                             |
| AI/Caption | Gemini API (caption generation & optimization)   |

---

## Cara Menjalankan

```bash
# Backend
cd backend && npm install && npm run dev   # http://localhost:5000

# Frontend
cd frontend && npm install && npm start    # http://localhost:3000
```

---

## Referensi

- [`.github/skills/social-publisher/SKILL.md`](.github/skills/social-publisher/SKILL.md) — Social Publisher Skill Guide
- [`docs/API_SETUP_GUIDE.md`](docs/API_SETUP_GUIDE.md) — Panduan setup API tiap platform
- [`backend/src/services/captionService.js`](backend/src/services/captionService.js) — Caption optimization service
- [`backend/src/services/scheduleStrategyService.js`](backend/src/services/scheduleStrategyService.js) — Scheduling strategy service
- [`backend/src/services/analyticsEnhancementService.js`](backend/src/services/analyticsEnhancementService.js) — Analytics enhancement service
