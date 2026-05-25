import { extractDriveLinkFromText } from './driveId.js';
import { escapeMarkdown } from './telegramMarkdown.js';

const DRIVE_URL_RE =
  /https?:\/\/(?:drive|docs)\.google\.com\/[^\s)>\]]+/gi;

/**
 * @typedef {object} MissionBriefing
 * @property {string} mainMessage
 * @property {string[]} keyPoints
 * @property {string} contentRules
 * @property {string[]} requiredHashtags
 * @property {string} [driveLink]
 * @property {string} [title]
 */

const MISSION_MARKERS =
  /pesan\s+utama|poin\s+penting|aturan\s+konten|misi\s+sonar|🎯\s*1\.|📌\s*2\.|✏️\s*5\./i;

/**
 * @param {string} text
 */
export function looksLikeMissionBroadcast(text) {
  if (!text || text.length < 80) return false;
  return MISSION_MARKERS.test(text);
}

/**
 * @param {string} body
 * @param {RegExp} startRe
 * @param {RegExp} endRe
 */
function sliceSection(body, startRe, endRe) {
  const startMatch = body.match(startRe);
  if (!startMatch || startMatch.index === undefined) return '';
  const from = startMatch.index + startMatch[0].length;
  const rest = body.slice(from);
  const endMatch = rest.match(endRe);
  const chunk = endMatch ? rest.slice(0, endMatch.index) : rest;
  return chunk
    .replace(/^━+/gm, '')
    .replace(/^[🎯📌✏️🔥📲📊⚡\s]+/gm, '')
    .trim();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractBulletPoints(block) {
  if (!block) return [];
  const lines = block.split(/\n+/);
  /** @type {string[]} */
  const points = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/^[\s•\u2060\u00a0\-–—\d.)、]+/u, '')
      .replace(/^\*+\s*/, '')
      .trim();
    if (cleaned.length > 8 && !/^https?:\/\//i.test(cleaned)) {
      points.push(cleaned);
    }
  }
  return points.slice(0, 8);
}

/**
 * @param {string} rulesBlock
 * @param {string} fullText
 * @returns {string[]}
 */
function extractRequiredHashtags(rulesBlock, fullText) {
  /** @type {string[]} */
  const tags = [];
  const wajibBlock = rulesBlock || fullText;
  const explicit = wajibBlock.match(
    /wajib\s+pakai\s+hashtag\s*:?\s*([^\n]+)/i
  );
  if (explicit?.[1]) {
    const found = explicit[1].match(/#[\w]+/gi) || [];
    tags.push(...found.map((t) => t.toLowerCase()));
  }
  const defaults = ['#JagaIndonesia', '#RupiahTetapKuat', '#JagaRupiahBersama'];
  const hay = `${wajibBlock}\n${fullText}`.toLowerCase();
  for (const tag of defaults) {
    if (hay.includes(tag.toLowerCase().replace('#', ''))) tags.push(tag);
  }
  for (const h of (fullText.match(/#[\w\u00C0-\u024F]+/gi) || []).slice(0, 5)) {
    tags.push(h);
  }
  return [...new Set(tags)];
}

/**
 * Parse broadcast misi (bagian 1, 2, 5 + link Drive jika ada).
 * @param {string} text
 * @returns {MissionBriefing | null}
 */
export function parseMissionBroadcast(text) {
  if (!looksLikeMissionBroadcast(text)) return null;

  const normalized = text.replace(/\r\n/g, '\n');

  const titleMatch = normalized.match(
    /misi\s+([^\n━]+)/i
  );

  const mainMessage = sliceSection(
    normalized,
    /(?:🎯\s*)?1\.\s*pesan\s+utama|pesan\s+utama/i,
    /(?:📌\s*)?2\.\s*poin\s+penting|poin\s+penting/i
  );

  const keyPointsBlock = sliceSection(
    normalized,
    /(?:📌\s*)?2\.\s*poin\s+penting|poin\s+penting/i,
    /(?:📲\s*)?3\.|wajib\s+posting|posting\s+di\s+semua/i
  );

  const contentRules = sliceSection(
    normalized,
    /(?:✏️\s*)?5\.\s*aturan\s+konten|aturan\s+konten/i,
    /(?:🔥\s*)?6\.|amplifikasi\s+konten\s+positif/i
  );

  const driveLink = extractDriveLinkFromText(normalized);
  const driveUrl =
    normalized.match(DRIVE_URL_RE)?.[0] || (driveLink ? `https://drive.google.com/drive/folders/${driveLink}` : '');

  return {
    title: titleMatch?.[1]?.trim() || 'Misi harian',
    mainMessage: mainMessage || '',
    keyPoints: extractBulletPoints(keyPointsBlock),
    contentRules: contentRules || '',
    requiredHashtags: extractRequiredHashtags(contentRules, normalized),
    driveLink: driveUrl || undefined,
  };
}

/**
 * @param {MissionBriefing} mission
 */
export function formatMissionSummary(mission) {
  const title = escapeMarkdown(mission.title);
  let msg = `📋 *${title}* tersimpan\n\n`;
  if (mission.mainMessage) {
    const main = escapeMarkdown(mission.mainMessage.slice(0, 500));
    msg += `*§1 Pesan utama:*\n${main}${mission.mainMessage.length > 500 ? '…' : ''}\n\n`;
  }
  if (mission.keyPoints.length) {
    msg += `*§2 Poin (${mission.keyPoints.length}):*\n`;
    msg += mission.keyPoints
      .slice(0, 5)
      .map((p) => `• ${escapeMarkdown(p.slice(0, 120))}`)
      .join('\n');
    msg += '\n\n';
  }
  if (mission.contentRules) {
    const rules = escapeMarkdown(mission.contentRules.slice(0, 400));
    msg += `*§5 Aturan:*\n${rules}${mission.contentRules.length > 400 ? '…' : ''}\n\n`;
  }
  if (mission.requiredHashtags.length) {
    msg += `Hashtag wajib: ${mission.requiredHashtags.join(' ')}\n\n`;
  }
  if (mission.driveLink) {
    msg += `🔗 Drive terdeteksi — membuka folder…\n\n`;
  }
  msg +=
    'Langkah berikut:\n' +
    '• Kirim *link Drive* (jika belum), atau\n' +
    '• Kirim *foto/video* langsung ke chat ini.';
  return msg;
}

/**
 * @param {MissionBriefing} mission
 */
export function buildMissionPromptForGemini(mission) {
  if (!mission) return '';

  const points =
    mission.keyPoints.length > 0
      ? mission.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '(tidak ada poin terpisah)';

  const tags =
    mission.requiredHashtags.length > 0
      ? mission.requiredHashtags.join(' ')
      : '';

  return (
    `\n\n=== MISI / BRIEFING HARI INI (WAJIB) ===\n` +
    `PESAN UTAMA (§1 — jadikan hook & nada, jangan copy mentah jika tidak cocok video):\n${mission.mainMessage || '(lihat media)'}\n\n` +
    `POIN PENTING (§2 — pilih 2-3 yang RELEVAN dengan isi video/gambar, bukan semua dipaksa):\n${points}\n\n` +
    `ATURAN KONTEN (§5):\n${mission.contentRules || 'Caption sesuai isi media; max 5 hashtag.'}\n` +
    (tags
      ? `\nWAJIB sertakan hashtag ini (masih dalam max 5 total): ${tags}\n`
      : '') +
    `Caption harus relevan dengan MEDIA yang dilampirkan. Nada: meyakinkan, bukan clickbait krisis.\n` +
    `WAJIB: tiap platform pakai kata & sudut berbeda (Instagram ≠ Threads ≠ Facebook).\n` +
    `Jangan format judul terpisah lalu mengulang kalimat yang sama di paragraf berikutnya.\n` +
    `=== AKHIR BRIEFING ===`
  );
}
