/** Batas karakter umum (caption + hashtag). */
export const PLATFORM_CHAR_LIMITS = {
  x: 275,
  twitter: 275,
  threads: 500,
  instagram: 2200,
  facebook: 60000,
  youtube: 4900,
  linkedin: 2950,
  tiktok: 2200,
  pinterest: 500,
  bluesky: 300,
};

/** Judul video YouTube (API Outstand / YouTube). */
export const YOUTUBE_TITLE_MAX = 100;
/** Deskripsi — Shorts lebih enak dibaca jika ringkas. */
export const YOUTUBE_DESCRIPTION_MAX = 500;

export const MAX_HASHTAGS = 5;

export function normalizeNetwork(network) {
  const n = (network || '').toLowerCase().trim();
  if (n === 'twitter') return 'x';
  return n;
}

/**
 * Ambil hashtag unik, maksimal N, lalu susun ulang caption (body + baris hashtag).
 * @param {string} text
 * @param {number} [max]
 */
export function limitHashtagsInCaption(text, max = MAX_HASHTAGS) {
  const raw = (text || '').trim();
  if (!raw) return '';

  const tags = [...new Set(raw.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || [])].slice(
    0,
    max
  );

  let body = raw;
  for (const tag of raw.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || []) {
    body = body.replace(new RegExp(`${tag}\\b`, 'g'), '');
  }
  body = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!tags.length) return body;
  return body ? `${body}\n\n${tags.join(' ')}` : tags.join(' ');
}

/**
 * @param {string} text
 */
export function splitBodyAndHashtags(text) {
  const normalized = limitHashtagsInCaption(text);
  const parts = normalized.split(/\n\n+/);
  const last = parts[parts.length - 1] || '';
  const lastIsTags =
    last.trim() &&
    last
      .trim()
      .split(/\s+/)
      .every((w) => w.startsWith('#'));

  if (lastIsTags && parts.length > 1) {
    return {
      body: parts.slice(0, -1).join('\n\n').trim(),
      hashtagLine: last.trim(),
    };
  }

  return { body: normalized.trim(), hashtagLine: '' };
}

/**
 * Potong di akhir kalimat / paragraf / kata — tanpa memotong tengah kata.
 * @param {string} text
 * @param {number} maxLen
 */
export function truncateAtSentence(text, maxLen) {
  const raw = (text || '').trim();
  if (raw.length <= maxLen) return raw;

  const paragraphs = raw.split(/\n\n+/);
  let acc = '';
  for (const p of paragraphs) {
    const next = acc ? `${acc}\n\n${p}` : p;
    if (next.length <= maxLen) {
      acc = next;
      continue;
    }
    if (!acc) {
      return truncateSingleBlock(p, maxLen);
    }
    break;
  }
  if (acc) return acc;
  return truncateSingleBlock(raw, maxLen);
}

function truncateSingleBlock(text, maxLen) {
  if (text.length <= maxLen) return text;

  let best = -1;
  for (let i = 0; i < text.length && i < maxLen; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n' && next === '\n') best = i;
    if (
      (ch === '.' || ch === '!' || ch === '?' || ch === '…') &&
      (!next || /\s/.test(next))
    ) {
      best = i + 1;
    }
  }

  if (best >= Math.floor(maxLen * 0.45)) {
    return text.slice(0, best).trim();
  }

  const slice = text.slice(0, maxLen);
  const lastSpace = Math.max(
    slice.lastIndexOf(' '),
    slice.lastIndexOf('\n')
  );
  if (lastSpace >= Math.floor(maxLen * 0.55)) {
    return slice.slice(0, lastSpace).trim();
  }

  return slice.trim();
}

/**
 * Sesuaikan panjang caption per platform tanpa memotong tengah kalimat.
 * @param {string} text
 * @param {string} network
 */
/**
 * Parse output Gemini format khusus YouTube.
 * @param {string} text
 */
export function parseYoutubeStructuredCaption(text) {
  const raw = (text || '').trim();
  const titleMatch = raw.match(/^TITLE:\s*(.+)$/im);
  const descMatch = raw.match(/^DESCRIPTION:\s*([\s\S]+)$/im);
  if (!titleMatch || !descMatch) return null;

  const title = truncateAtSentence(
    titleMatch[1].replace(/#[\w\u00C0-\u024F]+/g, '').trim(),
    YOUTUBE_TITLE_MAX
  );
  const description = limitHashtagsInCaption(descMatch[1].trim());
  return { title, description };
}

/**
 * Judul + deskripsi + tag dari caption umum.
 * @param {string} baseCaption
 */
export function buildYoutubePostFields(baseCaption) {
  const structured = parseYoutubeStructuredCaption(baseCaption);
  if (structured) {
    const description = truncateAtSentence(
      limitHashtagsInCaption(structured.description),
      YOUTUBE_DESCRIPTION_MAX
    );
    return {
      title: structured.title,
      description,
      tags: extractYoutubeTags(structured.description),
    };
  }

  const { body, hashtagLine } = splitBodyAndHashtags(baseCaption);
  const paragraphs = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  let title = '';
  if (paragraphs[0]) {
    title = paragraphs[0].replace(/#[\w\u00C0-\u024F]+/g, '').trim();
  }
  title = truncateAtSentence(title, YOUTUBE_TITLE_MAX);
  if (title.length < 12 && paragraphs[1]) {
    title = truncateAtSentence(
      paragraphs[1].replace(/#[\w\u00C0-\u024F]+/g, '').trim(),
      YOUTUBE_TITLE_MAX
    );
  }

  let description = paragraphs.length > 1 ? paragraphs.slice(1).join('\n\n') : body;
  if (!description.trim()) description = body;
  if (hashtagLine) description = `${description.trim()}\n\n${hashtagLine}`;
  description = truncateAtSentence(description.trim(), YOUTUBE_DESCRIPTION_MAX);

  return {
    title: title || truncateAtSentence(body, YOUTUBE_TITLE_MAX),
    description,
    tags: extractYoutubeTags(hashtagLine || body),
  };
}

/**
 * @param {string} text
 */
function extractYoutubeTags(text) {
  const fromHash = (text.match(/#[\w\u00C0-\u024F\u1E00-\u1EFF]+/g) || []).map((t) =>
    t.replace(/^#/, '').slice(0, 30)
  );
  return [...new Set(fromHash)].slice(0, 10);
}

export function adaptCaptionForPlatform(text, network) {
  const net = normalizeNetwork(network);
  if (net === 'youtube') {
    return buildYoutubePostFields(text).description;
  }

  const limit = PLATFORM_CHAR_LIMITS[net] || 2200;
  const { body, hashtagLine } = splitBodyAndHashtags(text);
  const tagPart = hashtagLine ? `\n\n${hashtagLine}` : '';

  const full = (body + tagPart).trim();
  if (full.length <= limit) return full;

  const maxBody = limit - tagPart.length;
  if (maxBody < 60) {
    return tagPart.trim().slice(0, limit);
  }

  const trimmedBody = truncateAtSentence(body, maxBody);
  return (trimmedBody + tagPart).trim();
}

/**
 * @param {string} baseCaption
 * @param {string[]} networks
 */
/**
 * Sisipkan hashtag wajib dengan kapitalisasi dari briefing.
 * @param {string} text
 * @param {string[]} requiredTags e.g. ['#JagaIndonesia']
 */
export function applyRequiredHashtags(text, requiredTags = []) {
  let out = limitHashtagsInCaption(text);
  for (const tag of requiredTags) {
    const norm = tag.startsWith('#') ? tag : `#${tag}`;
    if (!out.toLowerCase().includes(norm.toLowerCase())) {
      out = `${out}\n\n${norm}`;
    }
  }
  return limitHashtagsInCaption(out);
}

/**
 * Hindari pola "judul baris" lalu paragraf yang mengulang judul.
 * @param {string} text
 */
export function normalizeCaptionBody(text) {
  const { body, hashtagLine } = splitBodyAndHashtags(text);
  const paragraphs = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    const first = paragraphs[0].toLowerCase().replace(/[^\w\s]/g, '');
    const second = paragraphs[1].toLowerCase().replace(/[^\w\s]/g, '');
    if (
      first.length > 20 &&
      (second.startsWith(first.slice(0, Math.min(40, first.length))) ||
        first === second)
    ) {
      const merged = paragraphs.slice(1).join('\n\n');
      return hashtagLine ? `${merged}\n\n${hashtagLine}` : merged;
    }
  }
  return hashtagLine ? `${body}\n\n${hashtagLine}` : body;
}

const PLATFORM_MARKERS = {
  instagram: 'INSTAGRAM',
  threads: 'THREADS',
  facebook: 'FACEBOOK',
  tiktok: 'TIKTOK',
  youtube: 'YOUTUBE',
  x: 'X',
  twitter: 'X',
  linkedin: 'LINKEDIN',
};

/**
 * Parse output Gemini format ===PLATFORM===.
 * @param {string} text
 * @param {string[]} networks
 */
export function parseMultiPlatformCaptions(text, networks) {
  const raw = (text || '').trim();
  const unique = [...new Set(networks.map(normalizeNetwork))];
  /** @type {Record<string, string>} */
  const out = {};

  for (const net of unique) {
    const marker = PLATFORM_MARKERS[net] || net.toUpperCase();
    const re = new RegExp(
      `===\\s*${marker}\\s*===\\s*([\\s\\S]*?)(?=\\n===\\s*[A-Z]+\\s*===|$)`,
      'i'
    );
    const m = raw.match(re);
    if (m?.[1]) {
      out[net] = m[1].trim();
    }
  }

  return out;
}

/**
 * @param {string} raw
 * @param {string} network
 * @param {string[]} [requiredHashtags]
 */
export function finalizeCaptionForPlatform(raw, network, requiredHashtags = []) {
  const net = normalizeNetwork(network);
  if (net === 'youtube') {
    const yt = buildYoutubePostFields(raw);
    let description = applyRequiredHashtags(yt.description, requiredHashtags);
    description = truncateAtSentence(description, YOUTUBE_DESCRIPTION_MAX);
    return description;
  }

  let text = normalizeCaptionBody(raw);
  text = applyRequiredHashtags(text, requiredHashtags);
  return adaptCaptionForPlatform(text, net);
}

export function buildCaptionsByNetwork(baseCaption, networks, requiredHashtags = []) {
  const base = applyRequiredHashtags(
    normalizeCaptionBody(baseCaption),
    requiredHashtags
  );
  /** @type {Record<string, string>} */
  const out = {};
  const unique = [...new Set(networks.map(normalizeNetwork))];
  for (const net of unique) {
    out[net] = adaptCaptionForPlatform(base, net);
  }
  return out;
}

/**
 * Limit terpendek di antara platform terpilih (untuk generate caption Gemini).
 * @param {string[]} networks
 */
export function getMinCharLimitForNetworks(networks) {
  const unique = [...new Set(networks.map(normalizeNetwork).filter(Boolean))];
  if (!unique.length) return 2200;
  return Math.min(...unique.map((n) => PLATFORM_CHAR_LIMITS[n] || 2200));
}

/**
 * @param {string[]} networks
 */
export function getTightestPlatform(networks) {
  const unique = [...new Set(networks.map(normalizeNetwork).filter(Boolean))];
  let tightest = unique[0] || 'instagram';
  let minLimit = PLATFORM_CHAR_LIMITS[tightest] || 2200;
  for (const n of unique) {
    const lim = PLATFORM_CHAR_LIMITS[n] || 2200;
    if (lim < minLimit) {
      minLimit = lim;
      tightest = n;
    }
  }
  return { network: tightest, limit: minLimit };
}
