const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL  = 'gemini-flash-latest';

async function generateWithGemini(prompt, systemPrompt = null, maxTokens = 2000) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY belum diset di environment');

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents:         [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: maxTokens },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const res = await axios.post(url, body);
  if (!res.data.candidates?.[0]) throw new Error('Respons Gemini kosong');
  return res.data.candidates[0].content.parts[0].text;
}

// Generate caption untuk bulk post
async function generateCaption(config) {
  const { topic, platform, tone, language, additionalInfo } = config;

  const platformGuide = {
    facebook: 'Facebook — bisa panjang, dengan emoji, ajakan interaksi',
    instagram: 'Instagram — engaging, hashtag relevan di akhir',
    youtube: 'YouTube — deskripsi video menarik dengan kata kunci SEO',
    twitter: 'Twitter/X — singkat maksimal 280 karakter, to the point',
    tiktok: 'TikTok — energik, fun, dengan trending sound reference',
    threads: 'Threads — santai, conversational, seperti ngobrol'
  };

  const toneGuide = {
    formal: 'formal dan profesional',
    casual: 'santai dan friendly',
    funny: 'lucu dan menghibur',
    persuasive: 'persuasif dan meyakinkan',
    informative: 'informatif dan edukatif',
    emotional: 'emosional dan menyentuh hati'
  };

  const prompt = `Kamu adalah copywriter profesional untuk social media marketing Indonesia.

Buat caption untuk posting di ${platformGuide[platform] || platform}.

Topik/Produk: ${topic}
Tone: ${toneGuide[tone] || tone}
Bahasa: ${language || 'Indonesia'}
${additionalInfo ? `Info tambahan: ${additionalInfo}` : ''}

Persyaratan:
- Gunakan bahasa yang natural dan tidak kaku
- Sertakan call to action yang tepat
- Sesuaikan dengan platform ${platform}
- Tambahkan emoji yang relevan
- Jangan terlalu panjang untuk Twitter (maks 250 karakter)

Langsung berikan caption tanpa penjelasan tambahan.`;

  return await generateWithGemini(prompt);
}

// Generate variasi caption untuk banyak akun
async function generateCaptionVariations(config) {
  const { topic, platform, tone, language, count, additionalInfo } = config;

  const prompt = `Kamu adalah copywriter profesional untuk social media marketing Indonesia.

Buat ${count || 5} VARIASI BERBEDA caption untuk posting di platform ${platform}.

Topik/Produk: ${topic}
Tone: ${tone || 'casual'}
Bahasa: ${language || 'Indonesia'}
${additionalInfo ? `Info tambahan: ${additionalInfo}` : ''}

Persyaratan:
- Setiap variasi HARUS berbeda secara signifikan (bukan hanya ganti kata sinonim)
- Variasi 1: fokus pada manfaat produk
- Variasi 2: fokus pada testimoni/sosial proof
- Variasi 3: fokus pada penawaran/promo
- Variasi 4: fokus pada edukasi/tips
- Variasi 5: fokus pada storytelling
- Gunakan emoji yang relevan
- Sertakan call to action

Format output HARUS seperti ini (tanpa penjelasan lain):
VARIASI 1:
[caption 1]

VARIASI 2:
[caption 2]

VARIASI 3:
[caption 3]

VARIASI 4:
[caption 4]

VARIASI 5:
[caption 5]`;

  const raw = await generateWithGemini(prompt);
  
  // Parse variasi
  const variations = [];
  const parts = raw.split(/VARIASI \d+:/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) variations.push(trimmed);
  }

  return variations.length > 0 ? variations : [raw];
}

// Generate komentar natural untuk amplifikasi
async function generateComments(config) {
  const { topic, platform, count, style, stance, tone, contentType } = config;

  const styleGuide = {
    appreciative: 'mengagumi dan memuji konten',
    questioning: 'bertanya sesuatu yang relevan',
    sharing: 'berbagi pengalaman pribadi yang relevan',
    supportive: 'mendukung dan menyemangati',
    funny: 'lucu dan menghibur tapi tetap relevan',
    mixed: 'campuran berbagai gaya',
    santai: 'santai dan friendly, seperti ngobrol sama teman di social media',
    formal: 'formal dan profesional, seperti review resmi',
    kritis: 'kritis dan analitis, menyoroti detail',
    lucu: 'lucu dan menghibur dengan humor ringan Indonesia',
    pendek: 'singkat dan padat, maksimal 5-10 kata saja'
  };

  const stanceGuide = {
    pro: 'mendukung penuh, memuji, dan merekomendasikan konten ini',
    kontra: 'kritis, menyanggah, atau menunjukkan kekurangan dengan sopan',
    netral: 'netral, memberikan pendapat seimbang',
    positive: 'mendukung penuh, memuji, dan merekomendasikan konten ini',
    negative: 'kritis, menyanggah, atau menunjukkan kekurangan dengan sopan',
    neutral: 'netral, memberikan pendapat seimbang'
  };

  const contentTypeGuide = {
    standup_comedy: 'stand up comedy — fokus pada humor, punchline, delivery, komika, materi lucu, penonton tertawa',
    tutorial: 'tutorial/edukasi — fokus pada cara penjelasan, langkah-langkah, manfaat, hasil akhir, tips & trik',
    review: 'review produk — fokus pada fitur, kelebihan/kekurangan, harga, rekomendasi, perbandingan',
    vlog: 'vlog/lifestyle — fokus pada aktivitas sehari-hari, pengalaman, tempat, momen seru',
    music: 'musik/entertainment — fokus pada lagu, suara, lirik, aransemen, performance, artis',
    gaming: 'gaming — fokus pada gameplay, strategi, grafik, karakter, skill, konten seru',
    news: 'berita/informasi — fokus pada fakta, opini, isu terkini, analisis, dampak',
    motivasi: 'motivasi/inspirasi — fokus pada quotes, kisah sukses, semangat hidup, mindset',
    cooking: 'masak/kuliner — fokus pada resep, rasa, tampilan makanan, teknik memasak',
    sports: 'olahraga — fokus pada teknik, hasil pertandingan, atlet, strategi, latihan',
    other: 'konten umum'
  };

  const effectiveStance = stance || tone || 'netral';
  const effectiveStyle = style || 'mixed';
  const effectiveContentType = contentType || 'other';

  const systemPrompt = `Kamu adalah generator komentar social media AI. TUGAS UTAMAMU adalah membuat komentar yang SANGAT SPESIFIK dan RELEVAN dengan konten yang diberikan.

ATURAN PENTING:
1. SELALU analisis judul/topik konten TERLEBIH DAHULU sebelum membuat komentar.
2. JANGAN PERNAH membuat komentar tentang hal yang tidak disebutkan di judul/konteks.
3. JANGAN membuat komentar generic seperti "konten edukatif", "info penting", "berbobot", "tutorialnya bagus" kecuali memang spesifik.
4. Komentar harus terlihat seperti reaksi PENONTON ASLI yang baru saja menonton video tersebut.
5. Gunakan referensi spesifik dari judul/konteks dalam komentar.

Contoh BAIK untuk "Suci 12 show 3" (stand up comedy):
- "Stand up Raditya Dika di show 3 ini ngakak parah sih 😂"
- "Suci 12 makin seru, komika-komikanya pada jago delivery"
- "Show 3 paling ditunggu, materinya fresh semua 🔥"

Contoh BURUK (JANGAN lakukan):
- "Konten edukatif, sangat bermanfaat" ← terlalu generic
- "Tutorialnya jelas banget" ← tidak sesuai konteks
- "Spek kameranya daging semua" ← tidak relevan`;

  const contentTypeHint = contentTypeGuide[effectiveContentType]
    ? `JENIS KONTEN: ${contentTypeGuide[effectiveContentType]}. Buat komentar yang sesuai dengan jenis konten ini.`
    : '';

  const contextHint = topic
    ? `JUDUL/KONTEKS SPESIFIK: "${topic}". Setiap komentar HARUS merujuk langsung ke konten ini. Misal: jika judul tentang stand up comedy, komentar tentang humor/materi/komika. Jika tentang tutorial, komentar tentang cara/langkah/hasil.`
    : '';

  const platformHint = platform === 'youtube'
    ? 'Platform: YouTube. Komentar seperti penonton YouTube Indonesia yang baru selesai nonton video.'
    : `Platform: ${platform || 'social media'}`;

  const userPrompt = `Buat ${count || 10} komentar BERBEDA-BEDA dan NATURAL.

${contentTypeHint}
${contextHint}
${platformHint}

STANCE/NARASI: ${stanceGuide[effectiveStance] || stanceGuide.netral}
GAYA PENULISAN: ${styleGuide[effectiveStyle] || styleGuide.mixed}

Persyaratan PENTING:
- Setiap komentar HARUS terlihat ditulis oleh orang berbeda
- Gunakan variasi bahasa: formal, semi-formal, gaul Indonesia
- Variasi panjang: ada yang 1 kata, ada yang 1-2 kalimat
- Sertakan emoji secukupnya (tidak berlebihan)
- Jangan ada komentar yang mirip satu sama lain
- Terlihat natural, bukan seperti bot
- Campur bahasa Indonesia dan sedikit bahasa Inggris (natural)
- Sesuaikan dengan stance dan gaya yang diminta
- Komentar HARUS spesifik ke konten yang disebutkan, jangan generic

Format output (HANYA komentar, tanpa nomor, tanpa penjelasan):
[komentar 1]
[komentar 2]
...dst`;

  const raw = await generateWithGemini(userPrompt, systemPrompt, 2500);
  
  // Parse komentar
  const comments = raw.split('\n')
    .map(c => c.trim())
    .filter(c => c && !c.startsWith('[') && c.length > 1);

  return comments;
}

// Generate hashtag
async function generateHashtags(config) {
  const { topic, platform, count } = config;

  const prompt = `Buat ${count || 20} hashtag relevan untuk konten tentang "${topic}" di platform ${platform} Indonesia.

Persyaratan:
- Mix antara hashtag populer dan niche
- Relevan dengan topik
- Dalam bahasa Indonesia dan Inggris
- Format: #hashtag (satu per baris)
- Tanpa penjelasan tambahan`;

  const raw = await generateWithGemini(prompt);
  return raw.split('\n').map(h => h.trim()).filter(h => h.startsWith('#'));
}

// Generate reply untuk komentar yang masuk
async function generateReply(config) {
  const { comment, context, tone } = config;

  const prompt = `Kamu adalah admin social media yang responsif dan ramah.

Buat balasan untuk komentar berikut:
Komentar: "${comment}"
Konteks bisnis/produk: ${context}
Tone: ${tone || 'ramah dan profesional'}

Persyaratan:
- Balasan natural dan personal, tidak kaku
- Maksimal 2-3 kalimat
- Gunakan emoji secukupnya
- Langsung balas tanpa sapaan generik
- Sesuaikan bahasa dengan komentar (formal/gaul)

Langsung berikan balasan tanpa penjelasan.`;

  return await generateWithGemini(prompt);
}

module.exports = { generateCaption, generateCaptionVariations, generateComments, generateHashtags, generateReply };
