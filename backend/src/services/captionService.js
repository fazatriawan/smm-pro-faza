/**
 * Caption Optimization Service
 * Mengoptimasi caption dan hashtag per platform media sosial.
 */

const PLATFORM_RULES = {
  tiktok: {
    maxChars: 100,
    style: 'casual, trendy, fun, energik',
    hashtagCount: { min: 3, max: 5 },
    hashtagStyle: 'trending broad + niche (e.g. #fyp #viral #tipslife)',
    emojiUsage: 'wajib, minimal 2-3 emoji',
  },
  instagram: {
    maxChars: 2200,
    idealChars: 300,
    style: 'engaging, storytelling, inspiratif',
    hashtagCount: { min: 10, max: 15 },
    hashtagStyle: 'mix: 3-5 populer (>500K) + 5-7 medium + 3-5 niche',
    emojiUsage: 'disarankan, secukupnya',
  },
  youtube: {
    titleMaxChars: 60,
    descriptionMaxChars: 5000,
    style: 'SEO-optimized, informatif, keyword-rich',
    hashtagCount: { min: 3, max: 5 },
    hashtagStyle: 'keyword-based, relevan dengan topik video',
    emojiUsage: 'opsional di deskripsi',
  },
  linkedin: {
    maxChars: 3000,
    idealChars: 300,
    style: 'profesional, thought leadership, edukatif',
    hashtagCount: { min: 3, max: 5 },
    hashtagStyle: 'industri & profesional (e.g. #Marketing #Leadership)',
    emojiUsage: 'minimal, hanya untuk poin penting',
  },
  twitter: {
    maxChars: 280,
    style: 'concise, punchy, to the point',
    hashtagCount: { min: 1, max: 2 },
    hashtagStyle: 'trending atau sangat relevan, minimal',
    emojiUsage: 'opsional, 1-2 saja',
  },
  facebook: {
    maxChars: 63206,
    idealChars: 120,
    style: 'conversational, komunitas, relatable',
    hashtagCount: { min: 1, max: 3 },
    hashtagStyle: 'relevan dan familiar, tidak terlalu banyak',
    emojiUsage: 'disarankan untuk keterbacaan',
  },
  threads: {
    maxChars: 500,
    style: 'casual, conversational, santai',
    hashtagCount: { min: 3, max: 5 },
    hashtagStyle: 'relevan dan natural',
    emojiUsage: 'disarankan',
  },
  pinterest: {
    maxChars: 500,
    style: 'deskriptif, inspiratif, keyword-rich',
    hashtagCount: { min: 5, max: 10 },
    hashtagStyle: 'deskriptif dan searchable',
    emojiUsage: 'minimal',
  },
};

const HASHTAG_TEMPLATES = {
  tiktok: (content) => [
    '#fyp', '#viral', '#foryou',
    `#${content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    '#trending',
  ],
  instagram: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [
      `#${keyword}`, `#${keyword}tips`, `#${keyword}inspiration`,
      '#instagram', '#instadaily', '#instagood', '#photooftheday',
      '#explore', '#trending', '#viral',
      '#indonesia', '#kontenindonesia',
    ];
  },
  youtube: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [`#${keyword}`, '#youtube', '#tutorial', '#tips', '#howto'];
  },
  linkedin: () => [
    '#Marketing', '#SocialMedia', '#DigitalMarketing',
    '#Leadership', '#BusinessTips',
  ],
  twitter: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [`#${keyword}`, '#trending'];
  },
  facebook: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [`#${keyword}`, '#tips', '#info'];
  },
  threads: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [`#${keyword}`, '#threads', '#daily', '#viral', '#indonesia'];
  },
  pinterest: (content) => {
    const keyword = content.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return [
      `#${keyword}`, `#${keyword}ideas`, `#${keyword}inspiration`,
      '#diy', '#tips', '#howto', '#ideas', '#inspiration',
      '#save', '#tutorial',
    ];
  },
};

/**
 * Memendekkan caption agar tidak melebihi batas karakter platform.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateCaption(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

/**
 * Mengoptimasi caption untuk satu platform.
 * @param {string} originalCaption - Caption asli
 * @param {string} platform - Nama platform (tiktok, instagram, dll)
 * @returns {{ platform: string, caption: string, hashtags: string[], note: string }}
 */
function optimizeCaption(originalCaption, platform) {
  const key = platform.toLowerCase().replace('/', '_').replace('twitter_x', 'twitter');
  const rules = PLATFORM_RULES[key];
  if (!rules) {
    return { platform, caption: originalCaption, hashtags: [], note: 'Platform tidak dikenali, caption tidak diubah.' };
  }

  let caption = originalCaption.trim();
  const hashtags = generateHashtags(originalCaption, platform, rules.hashtagCount.max);

  if (key === 'tiktok') {
    caption = truncateCaption(caption, rules.maxChars);
    caption = `${caption} ${hashtags.slice(0, 3).join(' ')}`.trim();
    caption = truncateCaption(caption, rules.maxChars);

  } else if (key === 'instagram') {
    caption = truncateCaption(caption, rules.idealChars);
    const hashtagBlock = hashtags.join(' ');
    caption = `${caption}\n\n${hashtagBlock}`;

  } else if (key === 'youtube') {
    const title = truncateCaption(caption.split('\n')[0] || caption, rules.titleMaxChars);
    const description = truncateCaption(caption, rules.descriptionMaxChars);
    const hashtagBlock = hashtags.join(' ');
    caption = `TITLE: ${title}\n\nDESCRIPTION:\n${description}\n\n${hashtagBlock}`;

  } else if (key === 'linkedin') {
    caption = truncateCaption(caption, rules.idealChars);
    const hashtagBlock = hashtags.join(' ');
    caption = `${caption}\n\n${hashtagBlock}`;

  } else if (key === 'twitter') {
    const hashtagBlock = hashtags.slice(0, 2).join(' ');
    const available = rules.maxChars - hashtagBlock.length - 1;
    caption = `${truncateCaption(caption, available)} ${hashtagBlock}`.trim();

  } else if (key === 'facebook') {
    caption = truncateCaption(caption, rules.idealChars);
    const hashtagBlock = hashtags.slice(0, 3).join(' ');
    caption = `${caption}\n\n${hashtagBlock}`;

  } else {
    // threads, pinterest, dll
    caption = truncateCaption(caption, rules.maxChars || 500);
    const hashtagBlock = hashtags.join(' ');
    caption = `${caption}\n\n${hashtagBlock}`;
  }

  return {
    platform,
    caption: caption.trim(),
    hashtags,
    note: `Dioptimasi untuk ${platform}: ${rules.style}`,
  };
}

/**
 * Menghasilkan hashtag sesuai strategi platform.
 * @param {string} content - Konten/topik untuk referensi hashtag
 * @param {string} platform - Nama platform
 * @param {number} count - Jumlah hashtag yang diinginkan
 * @returns {string[]}
 */
function generateHashtags(content, platform, count = 5) {
  const key = platform.toLowerCase().replace('/', '_').replace('twitter_x', 'twitter');
  const generator = HASHTAG_TEMPLATES[key] || HASHTAG_TEMPLATES['instagram'];
  const tags = generator(content || 'konten');
  const rules = PLATFORM_RULES[key];
  const max = count || (rules ? rules.hashtagCount.max : 5);
  return tags.slice(0, max);
}

/**
 * Mengoptimasi caption untuk semua platform sekaligus (batch).
 * @param {string} originalCaption - Caption asli
 * @param {string[]} platforms - Array nama platform
 * @returns {Object.<string, { platform: string, caption: string, hashtags: string[], note: string }>}
 */
function adaptCaptionBatch(originalCaption, platforms) {
  const targetPlatforms = platforms && platforms.length > 0
    ? platforms
    : Object.keys(PLATFORM_RULES);

  const result = {};
  for (const platform of targetPlatforms) {
    result[platform] = optimizeCaption(originalCaption, platform);
  }
  return result;
}

module.exports = { optimizeCaption, generateHashtags, adaptCaptionBatch, PLATFORM_RULES };
