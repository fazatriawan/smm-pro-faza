const router = require('express').Router();
const axios  = require('axios');
const { protect } = require('../middleware/auth');
const { generateCaption, generateCaptionVariations, generateComments, generateHashtags, generateReply } = require('../services/aiService');

// ─── Helpers ────────────────────────────────────────────────────────────────────
async function callGemini(apiKey, model, systemPrompt, userPrompt, maxTokens = 2000) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-flash-latest'}:generateContent?key=${apiKey}`;
  const res  = await axios.post(url, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents:          [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig:  { maxOutputTokens: maxTokens, temperature: 0.8 },
  });
  if (!res.data.candidates?.[0]) throw new Error('Respons Gemini kosong');
  return res.data.candidates[0].content.parts[0].text || '';
}

const RSS_FEEDS = {
  antara: 'https://www.antaranews.com/rss/terkini.xml',
  detik:  'https://rss.detik.com/index.php/detikcom',
  kompas: 'https://rss.kompas.com/api/main_index',
  tempo:  'https://rss.tempo.co/',
  tribun: 'https://www.tribunnews.com/rss',
  cnn:    'https://www.cnnindonesia.com/rss',
};

// Generate caption tunggal
router.post('/caption', protect, async (req, res) => {
  try {
    const caption = await generateCaption(req.body);
    res.json({ caption });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate variasi caption untuk banyak akun
router.post('/caption/variations', protect, async (req, res) => {
  try {
    const variations = await generateCaptionVariations(req.body);
    res.json({ variations });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate komentar untuk amplifikasi
router.post('/comments', protect, async (req, res) => {
  try {
    const comments = await generateComments(req.body);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate hashtag
router.post('/hashtags', protect, async (req, res) => {
  try {
    const hashtags = await generateHashtags(req.body);
    res.json({ hashtags });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate reply komentar
router.post('/reply', protect, async (req, res) => {
  try {
    const reply = await generateReply(req.body);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Content Generator (video/carousel JSON) ────────────────────────────────────
router.post('/content/generate', protect, async (req, res) => {
  const { tema, data, contentType, model } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ message: 'GEMINI_API_KEY belum diset' });
  if (!tema)   return res.status(400).json({ message: 'tema wajib diisi' });

  let systemPrompt, userPrompt;
  if (contentType === 'gambar') {
    systemPrompt = `Bertindaklah sebagai Social Media Strategist dan Desainer Konten Carousel/Infografis untuk Instagram dan TikTok di Indonesia. Keahlian Anda adalah mengubah berita atau informasi menjadi konten carousel yang menarik, informatif, dan viral di kalangan Gen Z dan Milenial Indonesia.\n\nTujuan Konten: Mengedukasi masyarakat secara visual, ringkas, dan berbasis data. Tone bahasa santai, smart-casual, menggunakan istilah kekinian Indonesia.\n\nKembalikan response MURNI dalam format JSON dengan key berikut:\n- judul: judul konten carousel\n- hook_visual: teks hook untuk slide pertama (maks 8 kata, harus bikin penasaran/klik)\n- slides: array 5-7 slide, masing-masing { nomor, judul_slide, isi (2-3 kalimat padat), deskripsi_visual_inggris (deskripsi gambar pendukung slide dalam Bahasa Inggris, tanpa teks) }\n- caption: caption Instagram/TikTok siap pakai\n- hashtag: array string\n- prompt_cover_inggris: deskripsi gambar cover carousel dalam Bahasa Inggris untuk generate di AI image generator, tanpa teks/tulisan, estetis, ratio 1:1\n\nJangan ada teks lain selain JSON.`;
    userPrompt = `Tema yang dipilih: ${tema}\nReferensi Data/Berita: ${data || '-'}\n\nBuatkan 1 ide konten carousel/infografis yang komprehensif sesuai format JSON.`;
  } else {
    systemPrompt = `Bertindaklah sebagai Social Media Strategist dan Copywriter TikTok/Instagram Reels top tier di Indonesia. Keahlian utama Anda adalah mengubah berita formal atau informasi menjadi konten video pendek (di bawah 60 detik) yang viral, engaging, dan sangat disukai oleh Gen Z serta Milenial. Anda paham cara membuat hook 3 detik pertama yang mematikan agar penonton tidak scroll.\n\nTujuan Konten: Mengedukasi masyarakat secara elegan, logis, dan berbasis data. Tone bahasa santai, smart-casual, menggunakan istilah kekinian Indonesia.\n\nKembalikan response MURNI dalam format JSON dengan key berikut: judul, hook, visual, script, cta, caption, hashtag (array string), prompt_gambar_inggris (deskripsi singkat dalam Bahasa Inggris untuk generate gambar B-roll pendukung konten, tanpa teks/tulisan, realistis, estetis, cocok untuk TikTok/Reels 9:16). Jangan ada teks lain selain JSON.`;
    userPrompt = `Tema yang dipilih: ${tema}\nReferensi Data/Berita: ${data || '-'}\n\nBuatkan 1 ide konten video pendek yang komprehensif sesuai format JSON.`;
  }

  try {
    const text = await callGemini(apiKey, model, systemPrompt, userPrompt, 2000);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ message: 'Respons Gemini bukan JSON valid', raw: text, systemPrompt, userPrompt });
    const result = JSON.parse(match[0]);
    res.json({ success: true, result, systemPrompt, userPrompt });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    if (msg?.includes('quota') || msg?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ message: 'Kuota Gemini habis. Aktifkan billing di aistudio.google.com.' });
    }
    res.status(500).json({ message: msg });
  }
});

// ─── Scrape News (RSS) ─────────────────────────────────────────────────────────
router.get('/scrape/news', protect, async (req, res) => {
  const { sources, keyword, limit = 10 } = req.query;
  const kw       = keyword?.toLowerCase() || '';
  const selected = (sources ? sources.split(',') : Object.keys(RSS_FEEDS)).filter(s => RSS_FEEDS[s]);
  const articles = [];

  for (const src of selected) {
    try {
      const r   = await axios.get(RSS_FEEDS[src], { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const xml = r.data;
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const [, body] of items) {
        const title = (body.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || body.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
        const link  = body.match(/<link>(.*?)<\/link>/)?.[1]?.trim();
        const pubDate = body.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
        const description = (body.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || body.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g,'').trim();
        if (!title) continue;
        if (kw && !title.toLowerCase().includes(kw) && !(description||'').toLowerCase().includes(kw)) continue;
        articles.push({ source: src, title, link, pubDate, description });
      }
    } catch (_) { /* skip on error */ }
  }

  const sorted = articles
    .sort((a, b) => (!a.pubDate ? 1 : !b.pubDate ? -1 : new Date(b.pubDate) - new Date(a.pubDate)))
    .slice(0, Number(limit) * 3);

  res.json({ success: true, articles: sorted.slice(0, Number(limit)) });
});

// ─── Scrape Google Trends Indonesia ──────────────────────────────────────────────
router.get('/scrape/trends', protect, async (req, res) => {
  try {
    const r   = await axios.get('https://trends.google.com/trending/rss?geo=ID', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000,
    });
    const xml   = r.data;
    const items = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>|<title>(.*?)<\/title>/g)]
      .map(m => (m[1] || m[2] || m[3])?.trim()).filter(Boolean)
      .filter(t => !['Google Trends', 'Trending Searches in Indonesia'].includes(t));
    res.json({ success: true, trends: items.slice(0, 25) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Imagen B-roll Generator ──────────────────────────────────────────────────
router.post('/imagen/generate', protect, async (req, res) => {
  const { prompt } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)          return res.status(500).json({ message: 'GEMINI_API_KEY belum diset' });
  if (!prompt?.trim())  return res.status(400).json({ message: 'Prompt kosong' });

  const model      = 'gemini-flash-latest';
  const url        = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fullPrompt = `Generate a photorealistic vertical 9:16 B-roll image (no text, no watermarks, no UI elements): ${prompt.trim()}`;

  try {
    const r = await axios.post(url, {
      contents:         [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }, { timeout: 60000 });

    const parts  = r.data.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.data);
    if (!imgPart) return res.status(422).json({ message: 'Tidak ada gambar dikembalikan. Pastikan API key aktif dan model didukung.' });
    res.json({ success: true, base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    if (msg?.includes('quota') || msg?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ message: 'Kuota Gemini habis. Aktifkan billing di aistudio.google.com.' });
    }
    res.status(500).json({ message: msg });
  }
});

// ─── Sentiment Analysis ───────────────────────────────────────────────────────
router.post('/sentiment/analyze', protect, async (req, res) => {
  const { texts } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)             return res.status(500).json({ message: 'GEMINI_API_KEY belum diset' });
  if (!texts?.length)      return res.status(400).json({ message: 'texts wajib diisi' });

  const sys  = 'Kamu adalah analis sentimen teks berbahasa Indonesia. Selalu kembalikan HANYA JSON valid, tanpa teks lain.';
  const user = `Analisis sentimen dari daftar teks berita/judul berikut. Klasifikasikan setiap item sebagai "positif", "negatif", atau "netral".\n\nTeks:\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nKembalikan JSON: { "results": [{ "text": "...", "sentiment": "positif|negatif|netral", "score": 0.0-1.0, "reason": "alasan singkat" }], "summary": { "positif": N, "negatif": N, "netral": N } }`;

  try {
    const raw   = await callGemini(apiKey, 'gemini-flash-latest', sys, user, 2000);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ message: 'Respons tidak valid' });
    res.json({ success: true, ...JSON.parse(match[0]) });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error?.message || err.message });
  }
});

// ─── YouTube Trends Indonesia ─────────────────────────────────────────────────
// Keyword per kategori untuk search yang lebih relevan
const YT_CATEGORY_QUERIES = {
  '25': 'berita politik indonesia terbaru',
  '22': 'vlog indonesia',
  '24': 'entertainment indonesia',
  '28': 'teknologi sains indonesia',
};

// Fallback: scrape YouTube trending page jika API key tidak tersedia
async function scrapeYoutubeTrends(regionCode = 'ID') {
  const url = `https://www.youtube.com/feed/trending?gl=${regionCode}`;
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    },
    timeout: 15000,
  });

  // Extract ytInitialData dari script tag
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/);
  if (!match) throw new Error('Gagal mengekstrak data trending dari YouTube');

  const ytData = JSON.parse(match[1]);
  const tabs = ytData.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const tabContent = tabs[0]?.tabRenderer?.content;
  const sections = tabContent?.sectionListRenderer?.contents || [];

  const videos = [];
  for (const section of sections) {
    const items = section?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items ||
                  section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const vr = item?.videoRenderer || item?.gridVideoRenderer || item?.shelfRenderer?.content?.gridRenderer?.items?.[0]?.videoRenderer;
      if (!vr) continue;

      const videoId = vr.videoId;
      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
      const channel = vr.longBylineText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '';
      const thumbnails = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbnails[thumbnails.length - 1]?.url || thumbnails[0]?.url || '';

      // Parse view count dari text
      let viewCount = 0;
      const viewText = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map(r => r.text).join('') || '';
      const viewMatch = viewText.replace(/\./g, '').replace(/,/g, '').match(/([\d\s]+)/);
      if (viewMatch) viewCount = parseInt(viewMatch[1].replace(/\s/g, ''), 10) || 0;

      if (videoId && title) {
        videos.push({ id: videoId, title, channel, thumbnail, viewCount, likeCount: 0, publishedAt: new Date().toISOString() });
      }
    }
  }

  // Deduplicate dan batasi 20
  const seen = new Set();
  return videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  }).slice(0, 20);
}

// Fallback: scrape YouTube search untuk kategori spesifik
async function scrapeYoutubeSearch(query) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.youtube.com/results?search_query=${encodedQuery}&sp=CAMSAhAB`; // CAMSAhAB = sort by view count, video only
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    },
    timeout: 15000,
  });

  const match = html.match(/var ytInitialData = ({.+?});<\/script>/);
  if (!match) throw new Error('Gagal mengekstrak data search dari YouTube');

  const ytData = JSON.parse(match[1]);
  const contents = ytData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

  const videos = [];
  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const vr = item?.videoRenderer;
      if (!vr || !vr.videoId) continue;

      const videoId = vr.videoId;
      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
      const channel = vr.longBylineText?.runs?.[0]?.text || '';
      const thumbnails = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbnails[thumbnails.length - 1]?.url || thumbnails[0]?.url || '';

      let viewCount = 0;
      const viewText = vr.viewCountText?.simpleText || '';
      const viewMatch = viewText.replace(/\./g, '').replace(/,/g, '').match(/([\d\s]+)/);
      if (viewMatch) viewCount = parseInt(viewMatch[1].replace(/\s/g, ''), 10) || 0;

      videos.push({ id: videoId, title, channel, thumbnail, viewCount, likeCount: 0, publishedAt: new Date().toISOString() });
    }
  }

  const seen = new Set();
  return videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  }).slice(0, 20);
}

router.get('/youtube/trends', protect, async (req, res) => {
  const { categoryId = '0', regionCode = 'ID' } = req.query;
  const hasApiKey = !!process.env.YOUTUBE_API_KEY;

  try {
    let items = [];

    if (hasApiKey) {
      // Gunakan YouTube Data API v3 (lebih reliable)
      if (categoryId === '0' || !categoryId) {
        const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: {
            part:       'snippet,statistics',
            chart:      'mostPopular',
            regionCode,
            maxResults: 20,
            key:        process.env.YOUTUBE_API_KEY,
          },
        });
        items = r.data.items || [];
      } else {
        const query = YT_CATEGORY_QUERIES[categoryId] || 'indonesia';
        const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          params: {
            part:       'snippet',
            type:       'video',
            q:          query,
            regionCode,
            order:      'viewCount',
            maxResults: 20,
            key:        process.env.YOUTUBE_API_KEY,
          },
        });
        const videoIds = (searchRes.data.items || []).map(v => v.id.videoId).filter(Boolean);
        if (videoIds.length === 0) {
          return res.json({ success: true, items: [], source: 'api' });
        }
        const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: {
            part: 'snippet,statistics',
            id:   videoIds.join(','),
            key:  process.env.YOUTUBE_API_KEY,
          },
        });
        items = videosRes.data.items || [];
      }

      const result = items.map(v => ({
        id:          v.id,
        title:       v.snippet?.title,
        channel:     v.snippet?.channelTitle,
        thumbnail:   v.snippet?.thumbnails?.medium?.url,
        viewCount:   Number(v.statistics?.viewCount || 0),
        likeCount:   Number(v.statistics?.likeCount || 0),
        publishedAt: v.snippet?.publishedAt,
      }));

      return res.json({ success: true, items: result, source: 'api' });
    }

    // Fallback: scraping jika API key tidak tersedia
    if (categoryId === '0' || !categoryId) {
      items = await scrapeYoutubeTrends(regionCode);
    } else {
      const query = YT_CATEGORY_QUERIES[categoryId] || 'indonesia';
      items = await scrapeYoutubeSearch(query);
    }

    res.json({ success: true, items, source: 'scrape', notice: 'Menggunakan scraping sebagai fallback. Untuk hasil lebih akurat, tambahkan YOUTUBE_API_KEY di environment.' });
  } catch (err) {
    console.error('[YouTube Trends] Error:', err.message);
    res.status(500).json({ message: err.response?.data?.error?.message || err.message });
  }
});

// ─── YouTube Shorts Idea Generator ────────────────────────────────────────────
router.post('/youtube/shorts-idea', protect, async (req, res) => {
  const { videoId, title, channel, viewCount, description } = req.body;
  if (!title) return res.status(400).json({ message: 'Judul video wajib diisi' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ message: 'GEMINI_API_KEY belum diset' });

  const systemPrompt = `Kamu adalah Content Creator Strategist spesialis YouTube Shorts/TikTok/Reels di Indonesia. 
Tugasmu: analisis video trending dan buatkan ide clipping (shorts) yang viral-worthy.
Kembalikan response MURNI dalam format JSON dengan key:
- hook: hook 3 detik pertama yang mematikan (max 15 kata, bikin penasaran)
- timestamp: bagian video mana yang paling worth di-clip (format MM:SS-MM:SS)
- script: script voice over untuk shorts (30-50 detik, bahasa Indonesia santai, Gen Z/Millennial)
- caption: caption Instagram/TikTok/YouTube Shorts siap pakai
- hashtags: array hashtag relevan (5-8 hashtag)
- brollIdeas: array ide visual B-roll pendukung (3-5 ide)
- cta: call-to-action singkat

Tone: santai, smart-casual, kekinian. Gunakan bahasa Indonesia.`;

  const userPrompt = `Judul video trending: "${title}"
Channel: ${channel || 'Unknown'}
Views: ${Number(viewCount || 0).toLocaleString('id-ID')}
Deskripsi: ${description || 'Tidak tersedia'}

Buatkan ide shorts/clipping dari video ini yang berpotensi viral di Indonesia.`;

  try {
    const raw = await callGemini(apiKey, 'gemini-flash-latest', systemPrompt, userPrompt, 2000);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ message: 'Respons AI bukan JSON valid', raw });
    const result = JSON.parse(match[0]);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Schedule Strategy ────────────────────────────────────────────────────────
const { getOptimalPostingTime, generateWeeklySchedule, suggestBatchSchedule } = require('../services/scheduleStrategyService');

router.get('/schedule/strategy', protect, (req, res) => {
  const { platform, contentType } = req.query;
  if (!platform) {
    return res.status(400).json({ message: 'Parameter platform wajib diisi' });
  }
  const result = getOptimalPostingTime(platform, contentType);
  res.json({ success: true, ...result });
});

router.get('/schedule/weekly', protect, (req, res) => {
  const platforms = req.query.platforms ? req.query.platforms.split(',') : [];
  const contentTypes = req.query.contentTypes ? req.query.contentTypes.split(',') : [];
  const schedule = generateWeeklySchedule(platforms, contentTypes);
  res.json({ success: true, schedule });
});

router.get('/schedule/batch', protect, (req, res) => {
  const videoCount = parseInt(req.query.videoCount, 10) || 5;
  const platforms = req.query.platforms ? req.query.platforms.split(',') : ['tiktok', 'instagram'];
  const result = suggestBatchSchedule(videoCount, platforms);
  res.json({ success: true, ...result });
});

module.exports = router;
