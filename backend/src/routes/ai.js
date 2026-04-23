const router = require('express').Router();
const axios  = require('axios');
const { protect } = require('../middleware/auth');
const { generateCaption, generateCaptionVariations, generateComments, generateHashtags, generateReply } = require('../services/aiService');

// ─── Helpers ────────────────────────────────────────────────────────────────────
async function callGemini(apiKey, model, systemPrompt, userPrompt, maxTokens = 2000) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${apiKey}`;
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

  const model      = 'gemini-2.5-flash-preview-05-20';
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
    const raw   = await callGemini(apiKey, 'gemini-2.0-flash', sys, user, 2000);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ message: 'Respons tidak valid' });
    res.json({ success: true, ...JSON.parse(match[0]) });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error?.message || err.message });
  }
});

// ─── YouTube Trends Indonesia ─────────────────────────────────────────────────
router.get('/youtube/trends', protect, async (req, res) => {
  const { categoryId = '0', regionCode = 'ID' } = req.query;
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY; // fallback
  if (!process.env.YOUTUBE_API_KEY) return res.status(500).json({ message: 'YOUTUBE_API_KEY belum diset di environment' });

  try {
    const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part:       'snippet,statistics',
        chart:      'mostPopular',
        regionCode,
        categoryId,
        maxResults: 20,
        key:        process.env.YOUTUBE_API_KEY,
      },
    });
    const items = (r.data.items || []).map(v => ({
      id:          v.id,
      title:       v.snippet.title,
      channel:     v.snippet.channelTitle,
      thumbnail:   v.snippet.thumbnails?.medium?.url,
      viewCount:   Number(v.statistics?.viewCount || 0),
      likeCount:   Number(v.statistics?.likeCount || 0),
      publishedAt: v.snippet.publishedAt,
    }));
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error?.message || err.message });
  }
});

module.exports = router;
