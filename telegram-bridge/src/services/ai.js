import axios from 'axios';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ai');
import {
  limitHashtagsInCaption,
  adaptCaptionForPlatform,
  getTightestPlatform,
  parseYoutubeStructuredCaption,
  parseMultiPlatformCaptions,
  finalizeCaptionForPlatform,
  buildCaptionsByNetwork,
  buildYoutubePostFields,
  applyRequiredHashtags,
  truncateAtSentence,
  YOUTUBE_DESCRIPTION_MAX,
} from './captionPlatforms.js';
import { getTonePrompt } from '../config/captionTones.js';
import { buildMissionPromptForGemini } from '../utils/missionParse.js';

const tokenplusClient = env.tokenplusApiKey && !env.tokenplusApiKey.includes('your_tokenplus')
  ? axios.create({
      baseURL: 'https://tokenplus.net/v1',
      headers: { Authorization: `Bearer ${env.tokenplusApiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    })
  : null;

const openaiClient = env.openaiApiKey && !env.openaiApiKey.includes('your_openai')
  ? axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${env.openaiApiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    })
  : null;

if (openaiClient) log.info({ model: env.openaiModel }, '[AI] Primary: OpenAI');
if (tokenplusClient) log.info({ model: env.tokenplusModel }, '[AI] Fallback: TokenPlus');
if (!tokenplusClient && !openaiClient) {
  log.warn('[AI] Tidak ada AI API key — tambahkan TOKENPLUS_API_KEY atau OPENAI_API_KEY di .env');
}

const CAPTION_RULES = `You are a social media copywriter (Indonesia).
No markdown. Professional but engaging.

CRITICAL:
- Caption MUST match the ACTUAL video/image (what you SEE/HEAR). Mention specific visual elements.
- Do NOT invent metaphors unrelated to media (avoid clichés like "jas hujan" unless the video shows rain/weather).
- Do NOT use "title line" then repeat the same sentence in the next paragraph. Write flowing body text only.
- Each platform block MUST use DIFFERENT wording (not copy-paste).
- Exactly 5 hashtags on the last line only. Use proper casing for brand tags when given in briefing.`;

/**
 * @param {string[]} networks
 */
function buildMultiPlatformFormatInstruction(networks) {
  const unique = [...new Set(networks.map((n) => n.toLowerCase()))];
  const blocks = unique
    .map((net) => {
      if (net === 'youtube') {
        return (
          `===YOUTUBE===\n` +
          `TITLE: [max 90 char, no hashtags, hook only]\n` +
          `DESCRIPTION: [max 400 char, 2-3 NEW sentences — do NOT repeat title; last line hashtags]`
        );
      }
      const limit =
        net === 'threads' ? 500 : net === 'x' ? 275 : net === 'facebook' ? 600 : 2200;
      return (
        `===${net.toUpperCase()}===\n` +
        `[Unique caption for ${net}, max ~${Math.min(limit, 480)} chars total incl. hashtags. ` +
        `2-4 sentences + CTA, then hashtag line. Different angle than other platforms.]`
      );
    })
    .join('\n\n');

  return (
    `\n\nOUTPUT FORMAT (WAJIB — semua blok di bawah, tanpa teks lain):\n\n${blocks}\n\n` +
    `Jangan gabung platform dalam satu blok. Tiap platform WAJIB beda kata & sudut.`
  );
}

function sanitizeForApi(str) {
  // Remove lone Unicode surrogates (\uD800-\uDFFF) that make JSON invalid
  return String(str || '').replace(/[\uD800-\uDFFF]/g, '');
}

// ─── OpenAI-compatible helper ─────────────────────────────────────────────────

async function callOpenAICompat(client, model, messages, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.post('/chat/completions', { model, max_tokens: 2048, messages });
      const text = res.data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${label} returned an empty caption`);
      return text;
    } catch (err) {
      const status = err?.response?.status;
      const isRetryable =
        status === 524 || status === 502 || status === 503 || status === 504 ||
        err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      if (isRetryable && attempt < 2) {
        log.warn({ attempt: attempt + 1, status, code: err.code }, `[${label}] timeout — retry`);
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      log.error({ status, model, msg: err.message }, `[${label}] API error: ${status}`);
      throw err;
    }
  }
}

async function buildTokenPlusParts(context) {
  const { folderName, mediaFiles, targetNetworks, tone, missionBriefing } = context;
  const videos = mediaFiles.filter((f) => f.mimeType?.startsWith('video/'));
  const images = mediaFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const primaryType = videos.length ? 'video' : images.length ? 'image' : 'unknown';

  const fileList = mediaFiles.map((f, i) => `${i + 1}. ${f.name} (${f.mimeType})`).join('\n');
  const netsNorm = (targetNetworks || []).map((n) => n.toLowerCase());
  const uniqueNets = [...new Set(netsNorm.map((n) => (n === 'twitter' ? 'x' : n)))];

  let mediaNote = '';
  if (primaryType === 'video') {
    mediaNote =
      '\n\nKonten utama: VIDEO (tidak bisa dilampirkan langsung). ' +
      'Turunkan caption dari nama file & briefing, tetap spesifik dan visual.';
  }

  const toneNote = tone ? `\n\n${getTonePrompt(tone)}` : '';
  const missionNote = buildMissionPromptForGemini(missionBriefing);
  const formatNote = buildMultiPlatformFormatInstruction(uniqueNets);

  const promptText = sanitizeForApi(
    `${CAPTION_RULES}${toneNote}${missionNote}${mediaNote}${formatNote}\n\n` +
    `Folder / tema: ${folderName}\nFile:\n${fileList}`
  );

  const messages = [{ role: 'user', content: promptText }];
  return { messages, uniqueNets, missionBriefing };
}

// ─── Unified call ─────────────────────────────────────────────────────────────

async function callAI(context) {
  if (!tokenplusClient && !openaiClient) {
    throw new Error('Tidak ada AI API key — tambahkan TOKENPLUS_API_KEY atau OPENAI_API_KEY di .env');
  }
  const { messages, uniqueNets, missionBriefing } = await buildTokenPlusParts(context);

  // Coba OpenAI dulu; kalau gagal (524/timeout) dan TokenPlus tersedia → fallback
  if (openaiClient) {
    try {
      const raw = await callOpenAICompat(openaiClient, env.openaiModel, messages, 'OpenAI');
      return { raw, uniqueNets, missionBriefing };
    } catch (err) {
      const status = err?.response?.status;
      const isGateway = status === 524 || status === 502 || status === 503 || status === 504 ||
        err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED';
      if (isGateway && tokenplusClient) {
        log.warn({ status }, '[AI] OpenAI gagal — fallback ke TokenPlus');
      } else {
        throw err;
      }
    }
  }

  // TokenPlus sebagai primary (jika OpenAI tidak dikonfigurasi) atau fallback
  const raw = await callOpenAICompat(tokenplusClient, env.tokenplusModel, messages, 'TokenPlus');
  return { raw, uniqueNets, missionBriefing };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate caption berbeda per platform.
 * @param {{ folderName: string, mediaFiles: object[], targetNetworks?: string[], tone?: string, missionBriefing?: object }} context
 */
export async function generateCaptionsByNetwork(context) {
  const { raw, uniqueNets, missionBriefing } = await callAI(context);
  const required = missionBriefing?.requiredHashtags || [];

  const parsed = parseMultiPlatformCaptions(raw, uniqueNets);

  /** @type {Record<string, string>} */
  const byNetwork = {};
  /** @type {{ title: string, description: string, tags: string[] } | null} */
  let youtubeFields = null;

  for (const net of uniqueNets) {
    if (!parsed[net]) continue;
    if (net === 'youtube') {
      const yt = buildYoutubePostFields(parsed[net]);
      youtubeFields = {
        title: yt.title,
        description: truncateAtSentence(
          applyRequiredHashtags(yt.description, required),
          YOUTUBE_DESCRIPTION_MAX
        ),
        tags: yt.tags,
      };
      byNetwork.youtube = youtubeFields.description;
    } else {
      byNetwork[net] = finalizeCaptionForPlatform(parsed[net], net, required);
    }
  }

  if (Object.keys(byNetwork).length < uniqueNets.length) {
    const provider = tokenplusClient ? 'TokenPlus' : 'OpenAI';
    log.warn(`[${provider}] Multi-platform parse incomplete, fallback single caption`);
    const single = await generateCaption(context);
    const fallback = buildCaptionsByNetwork(single, uniqueNets, required);
    for (const net of uniqueNets) {
      if (!byNetwork[net]) byNetwork[net] = fallback[net];
    }
  }

  const baseCaption =
    byNetwork.instagram ||
    byNetwork.threads ||
    byNetwork.facebook ||
    Object.values(byNetwork)[0] ||
    '';

  return { baseCaption, captionsByNetwork: byNetwork, youtubeFields };
}

/**
 * Satu caption dasar (fallback / kompatibilitas).
 * @param {{ folderName: string, mediaFiles: object[], targetNetworks?: string[], charLimit?: number, tone?: string, missionBriefing?: object }} context
 */
export async function generateCaption(context) {
  const { targetNetworks, charLimit, missionBriefing } = context;
  const netsNorm = (targetNetworks || []).map((n) => n.toLowerCase());
  const onlyYoutube =
    netsNorm.length === 1 && (netsNorm[0] === 'youtube' || netsNorm[0] === 'yt');

  if (targetNetworks?.length && !onlyYoutube) {
    const { baseCaption } = await generateCaptionsByNetwork(context);
    return baseCaption;
  }

  const { raw } = await callAI(context);
  const required = missionBriefing?.requiredHashtags || [];

  const ytParsed = parseYoutubeStructuredCaption(raw);
  if (ytParsed) {
    return applyRequiredHashtags(ytParsed.description, required);
  }

  let out = applyRequiredHashtags(normalizeCaptionBody(raw), required);
  if (charLimit && targetNetworks?.length) {
    const { network } = getTightestPlatform(targetNetworks);
    out = adaptCaptionForPlatform(out, network);
  } else if (onlyYoutube) {
    out = adaptCaptionForPlatform(out, 'youtube');
  }
  return out;
}

function normalizeCaptionBody(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate N variasi caption dari satu caption dasar.
 * Setiap variasi: 1 kalimat diparafrase + urutan hashtag di-shuffle.
 * Elemen pertama array adalah caption asli.
 * @param {string} caption
 * @param {number} count - jumlah total variasi (termasuk asli)
 * @returns {Promise<string[]>}
 */
export async function generateCaptionVariations(caption, count) {
  if (count <= 1) return [caption];

  const hashtags = (caption.match(/#\w+/g) || []);
  const textOnly = caption.replace(/#\w+/g, '').trim();
  const hashtagSep = /\n#/.test(caption) ? '\n' : ' ';

  let textVariants = [];

  if (textOnly && (tokenplusClient || openaiClient)) {
    try {
      const needed = count - 1;
      const prompt = sanitizeForApi(
        `Buat ${needed} variasi teks caption berikut. Tiap variasi: pilih 1 kalimat, ubah dengan sinonim/parafrase (makna tetap sama), kalimat lain tetap persis sama. Return JSON array berisi ${needed} string. Tanpa hashtag. Tanpa penjelasan. Hanya JSON.\n\nCaption: "${textOnly}"`
      );

      const messages = [{ role: 'user', content: prompt }];
      let raw = '';
      try {
        if (tokenplusClient) {
          raw = await callOpenAICompat(tokenplusClient, env.tokenplusModel, messages, 'TokenPlus');
        } else {
          raw = await callOpenAICompat(openaiClient, env.openaiModel, messages, 'OpenAI');
        }
      } catch (aiErr) {
        if (tokenplusClient && openaiClient) {
          raw = await callOpenAICompat(openaiClient, env.openaiModel, messages, 'OpenAI');
        } else {
          throw aiErr;
        }
      }

      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) textVariants = JSON.parse(match[0]).filter(Boolean);
    } catch (err) {
      log.warn({ err: err.message }, '[AI] generateCaptionVariations gagal — pakai teks asli');
    }
  }

  const results = [caption];
  for (let i = 0; i < count - 1; i++) {
    const varText = (textVariants[i] || textOnly).trim();
    const shuffled = shuffleArray(hashtags);
    const varCaption = hashtags.length
      ? varText + hashtagSep + shuffled.join(' ')
      : varText;
    results.push(varCaption.trim());
  }
  return results;
}
