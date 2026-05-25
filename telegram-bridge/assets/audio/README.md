# Musik latar YouTube (gambar → video)

Letakkan file musik **bebas royalti** di folder ini — **nama bebas**, contoh:

- `beat-12s.mp3`
- `lagu-latar.m4a`
- `musik.wav`

Bot otomatis memakai **file audio pertama** yang ditemukan di folder ini (urutan abjad).

Opsional, jika file ada di lokasi lain, set di `.env`:

```env
YOUTUBE_IMAGE_AUDIO_PATH=C:/path/ke/musik-anda.mp3
YOUTUBE_IMAGE_VIDEO_DURATION_SEC=12
```

Bot akan menggabungkan **gambar dari Drive + musik** menjadi video MP4 vertikal (±15 detik) untuk:

- YouTube Shorts
- Instagram Reels / video
- Threads
- Facebook (video post)

Platform bisa diatur lewat `IMAGE_TO_VIDEO_NETWORKS` di `.env`.
