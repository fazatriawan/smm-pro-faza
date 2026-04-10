---
name: social-publisher
description: >
  Skill untuk mempublikasikan konten ke multi-platform media sosial dari SMM Pro Dashboard.
  Gunakan skill ini ketika diminta untuk: posting konten ke platform (TikTok, Instagram, YouTube,
  LinkedIn, Twitter/X, Facebook, Threads, Pinterest), mengoptimasi caption per platform,
  menjadwalkan konten, mengelola hashtag, atau menganalisis performa konten.
---

# Social Publisher Skill — SMM Pro

Skill ini mengintegrasikan workflow publishing multi-platform ke dalam SMM Pro Dashboard
(`fazatriawan/smm-pro-faza`). Skill mencakup optimasi caption, scheduling strategy,
manajemen hashtag, dan analytics tracking.

---

## Workflow Publishing Multi-Platform

### 1. Persiapan Konten
```
Sumber konten (Google Drive / Upload lokal)
    ↓
Validasi format & ukuran per platform
    ↓
Optimasi caption per platform (via /api/caption/optimize-batch)
    ↓
Generate hashtag per platform (via /api/caption/hashtags)
    ↓
Tentukan jadwal optimal (via /api/schedule-strategy/optimal-time)
```

### 2. Platform Support

| Platform    | Tipe Konten          | Format Utama       |
|-------------|----------------------|--------------------|
| TikTok      | Short video          | MP4, max 500MB     |
| Instagram   | Image / Reel / Story | JPG/PNG/MP4        |
| YouTube     | Long video / Short   | MP4, max 256GB     |
| LinkedIn    | Post / Video / Artikel | JPG/PNG/MP4      |
| Twitter/X   | Tweet / Thread       | JPG/PNG/MP4 ≤512MB |
| Facebook    | Post / Reel / Story  | JPG/PNG/MP4        |
| Threads     | Post / Thread        | JPG/PNG            |
| Pinterest   | Pin / Idea Pin       | JPG/PNG/MP4        |

### 3. Bulk Publishing via API
```
POST /api/posts
{
  "caption": "...",
  "accountIds": ["id1", "id2"],
  "scheduledAt": "2024-01-15T11:00:00Z",
  "platformOverrides": {
    "youtube": { "title": "...", "description": "..." },
    "twitter": { "caption": "..." }
  }
}
```

---

## Caption Optimization Templates per Platform

### TikTok
- **Gaya**: Casual, energik, fun, trendy
- **Panjang**: Maks 100 karakter caption utama
- **Format**: Singkat + hook kuat di awal + 3-5 hashtag trending
- **Emoji**: Wajib, gunakan yang trending
- **Contoh**: `POV: kamu baru nemuin tips ini 🤯 #fyp #viral #tips`
- **API**: `POST /api/caption/optimize` dengan `platform: "tiktok"`

### Instagram
- **Gaya**: Engaging, storytelling, inspiratif
- **Panjang**: 150-300 karakter ideal, maks 2200
- **Format**: Hook → Cerita/Value → CTA → Hashtag (di akhir atau komentar pertama)
- **Hashtag**: 5-15 hashtag, mix populer + niche
- **API**: `POST /api/caption/optimize` dengan `platform: "instagram"`

### YouTube
- **Gaya**: SEO-optimized, informatif
- **Judul**: Maks 60 karakter, sertakan keyword utama
- **Deskripsi**: 200-500 kata, sertakan timestamps, link, hashtag
- **Format**: Keyword di 100 karakter pertama
- **API**: `POST /api/caption/optimize` dengan `platform: "youtube"`

### LinkedIn
- **Gaya**: Profesional, thought leadership, edukatif
- **Panjang**: 150-300 karakter ideal, maks 3000
- **Format**: Hook profesional → Insight → Lesson → CTA
- **Hashtag**: 3-5 hashtag industri yang relevan
- **API**: `POST /api/caption/optimize` dengan `platform: "linkedin"`

### Twitter/X
- **Gaya**: Concise, punchy, to the point
- **Panjang**: Maks 280 karakter
- **Format**: Statement kuat atau pertanyaan provokatif
- **Hashtag**: 1-2 hashtag saja
- **API**: `POST /api/caption/optimize` dengan `platform: "twitter"`

### Facebook
- **Gaya**: Conversational, komunitas, relatable
- **Panjang**: 80-120 karakter ideal
- **Format**: Cerita personal → CTA interaksi
- **Hashtag**: 1-3 hashtag relevan
- **API**: `POST /api/caption/optimize` dengan `platform: "facebook"`

---

## Hashtag Strategy per Platform

### TikTok Hashtag Strategy
```
Kombinasi: 1-2 mega hashtag (#fyp, #viral) + 1-2 topik (#tips, #tutorial) + 1 niche
Jumlah: 3-5 hashtag
Penempatan: Di dalam caption
API: POST /api/caption/hashtags { platform: "tiktok", count: 5 }
```

### Instagram Hashtag Strategy
```
Kombinasi: 3-5 populer (>500K) + 5-7 medium (50K-500K) + 3-5 niche (<50K)
Jumlah: 10-15 hashtag
Penempatan: Akhir caption atau komentar pertama
API: POST /api/caption/hashtags { platform: "instagram", count: 15 }
```

### YouTube Hashtag Strategy
```
Fokus: 3-5 keyword-based hashtag
Penempatan: Di deskripsi video
Format: #KeywordUtama #NicheTopik #BrandName
API: POST /api/caption/hashtags { platform: "youtube", count: 5 }
```

### LinkedIn Hashtag Strategy
```
Fokus: Hashtag industri & profesional
Jumlah: 3-5 hashtag
Contoh: #Marketing #SocialMedia #DigitalMarketing
API: POST /api/caption/hashtags { platform: "linkedin", count: 5 }
```

### Twitter/X Hashtag Strategy
```
Minimal: 1-2 hashtag saja agar tidak spam
Pilih: Yang sedang trending atau sangat relevan
API: POST /api/caption/hashtags { platform: "twitter", count: 2 }
```

---

## Scheduling Strategy — Best Posting Times

### Optimal Times per Platform

| Platform    | Best Days       | Best Hours (WIB)         |
|-------------|-----------------|--------------------------|
| TikTok      | Setiap hari     | 07.00, 12.00, 19.00      |
| Instagram   | Sel, Rab, Jum   | 11.00-13.00, 19.00-21.00 |
| YouTube     | Kam, Jum, Sab   | 14.00-16.00              |
| LinkedIn    | Sel, Rab, Kam   | 08.00-10.00              |
| Twitter/X   | Setiap hari     | 09.00, 12.00, 17.00      |
| Facebook    | Rab, Kam, Jum   | 13.00-16.00              |

### API untuk Scheduling
```
# Dapatkan waktu optimal
GET /api/schedule-strategy/optimal-time?platform=instagram&contentType=reel

# Generate jadwal mingguan
POST /api/schedule-strategy/weekly
{ "platforms": ["tiktok", "instagram", "youtube"], "contentTypes": ["video", "image"] }

# Batch schedule untuk banyak konten
POST /api/schedule-strategy/batch
{ "videoCount": 7, "platforms": ["tiktok", "instagram"] }
```

---

## Content Calendar Template (Weekly)

```
SENIN
  - TikTok: 07:00 (motivasi pagi)
  - Instagram: 11:00 (konten edukatif)
  
SELASA
  - LinkedIn: 09:00 (thought leadership)
  - Twitter/X: 12:00 (tips singkat)
  
RABU  
  - TikTok: 19:00 (entertainment)
  - Facebook: 14:00 (komunitas)
  
KAMIS
  - YouTube: 15:00 (tutorial panjang)
  - LinkedIn: 09:00 (artikel industri)
  
JUMAT
  - Instagram: 20:00 (weekend preview)
  - TikTok: 19:00 (GRWM / vlog)
  
SABTU
  - YouTube: 14:00 (weekend content)
  - Instagram: 11:00 (lifestyle)
  
MINGGU
  - Facebook: 15:00 (recap mingguan)
  - Twitter/X: 09:00 (inspirasi minggu baru)
```

---

## Analytics Tracking Fields

### Cross-Platform Metrics
```javascript
{
  views: Number,         // Total tayangan
  likes: Number,         // Total likes/hearts
  comments: Number,      // Total komentar
  shares: Number,        // Total share/retweet/repost
  saves: Number,         // Total save/bookmark
  reach: Number,         // Unique accounts reached
  impressions: Number,   // Total tampilan (including repeat)
  engagementRate: Float  // (likes+comments+shares+saves) / views * 100
}
```

### API Analytics Enhancement
```
# Hitung engagement rate
GET /api/analytics/engagement-rate/:postId

# Generate laporan performa
GET /api/analytics/performance-report?accountId=xxx&startDate=2024-01-01&endDate=2024-01-31

# Top performing content
GET /api/analytics/top-content?accountId=xxx&limit=10

# Rekomendasi strategi konten
GET /api/analytics/content-suggestions?accountId=xxx
```

---

## Referensi API Endpoints SMM Pro

### Caption
```
POST /api/caption/optimize        — Optimasi caption 1 platform
POST /api/caption/optimize-batch  — Optimasi semua platform sekaligus
POST /api/caption/hashtags        — Generate hashtag
```

### Schedule Strategy
```
GET  /api/schedule-strategy/optimal-time  — Waktu posting optimal
POST /api/schedule-strategy/weekly        — Jadwal mingguan otomatis
POST /api/schedule-strategy/batch         — Batch schedule
```

### Analytics Enhancement
```
GET  /api/analytics/engagement-rate/:postId   — Engagement rate
GET  /api/analytics/performance-report         — Laporan performa
GET  /api/analytics/top-content               — Konten terbaik
GET  /api/analytics/content-suggestions       — Rekomendasi konten
```

### Existing Endpoints
```
POST /api/posts                    — Buat & publish/schedule post bulk
GET  /api/analytics/summary        — Ringkasan semua akun
GET  /api/analytics/account/:id    — Time-series satu akun
GET  /api/accounts                 — List akun tersambung
```

---

## Batch Publishing Workflow

```
1. Persiapkan konten (video/gambar)
2. Upload ke platform (POST /api/posts dengan file)
3. Optimasi caption batch (POST /api/caption/optimize-batch)
4. Generate jadwal mingguan (POST /api/schedule-strategy/weekly)
5. Buat post terjadwal untuk setiap slot:
   POST /api/posts {
     caption: optimizedCaptions[platform],
     accountIds: [...],
     scheduledAt: schedule[day][platform],
     platformOverrides: { ... }
   }
6. Monitor status via GET /api/posts
7. Track performa via GET /api/analytics/performance-report
```
