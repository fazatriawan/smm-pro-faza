import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
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

const genAI = new GoogleGenerativeAI(env.geminiApiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

const MAX_VIDEO_BYTES = 18 * 1024 * 1024;

const CAPTION_RULES = `You are a social media copywriter (Indonesia).
No markdown. Professional but engaging.

CRITICAL:
- Caption MUST match the ACTUAL video/image (what you SEE/HEAR). Mention specific visual elements.
- Do NOT invent metaphors unrelated to media (avoid clichés like "jas hujan" unless the video shows rain/weather).
- Do NOT use "title line" then repeat the same sentence in the next paragraph. Write flowing body text only.
- Each platform block MUST use DIFFERENT wording (not copy-paste).
- Max 5 hashtags on the last line only. Use proper casing for brand tags when given in briefing.`;

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

/**
 * @param {object} context
 * @param {import('@google/generative-ai').Part[]} parts
 */
async function callGemini(parts) {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
  });
  const text = result.response.text()?.trim();
  if (!text) throw new Error('Gemini returned an empty caption');
  return text;
}

/**
 * @param {object} context
 */
async function buildGeminiParts(context) {
  const { folderName, mediaFiles, targetNetworks, tone, missionBriefing } = context;
  const videos = mediaFiles.filter((f) => f.mimeType?.startsWith('video/'));
  const images = mediaFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const primaryType = videos.length ? 'video' : images.length ? 'image' : 'unknown';

  const fileList = mediaFiles
    .map((f, i) => `${i + 1}. ${f.name} (${f.mimeType})`)
    .join('\n');

  const netsNorm = (targetNetworks || []).map((n) => n.toLowerCase());
  const uniqueNets = [...new Set(netsNorm.map((n) => (n === 'twitter' ? 'x' : n)))];

  let mediaNote = '';
  if (primaryType === 'video') {
    mediaNote =
      '\n\nKonten utama: VIDEO terlampir. WAJIB jelaskan apa yang terlihat/terdengar di video, lalu hubungkan ke briefing (jika ada).';
  }

  const toneNote = tone ? `\n\n${getTonePrompt(tone)}` : '';
  const missionNote = buildMissionPromptForGemini(missionBriefing);
  const formatNote = buildMultiPlatformFormatInstruction(uniqueNets);

  const textPart = {
    text:
      `${CAPTION_RULES}${toneNote}${missionNote}${mediaNote}${formatNote}\n\n` +
      `Folder / tema: ${folderName}\nFile:\n${fileList}`,
  };

  const parts = [textPart];

  const firstVideo = videos[0];
  if (firstVideo) {
    try {
      let buffer;
      let mimeType = firstVideo.mimeType || 'video/mp4';
      let name = firstVideo.name;
      if (firstVideo.buffer) buffer = firstVideo.buffer;
      else if (firstVideo.id) {
        const dl = await downloadFile(firstVideo.id);
        buffer = dl.buffer;
        mimeType = dl.mimeType;
        name = dl.name;
      }
      if (buffer && buffer.length <= MAX_VIDEO_BYTES) {
        parts.push({
          inlineData: {
            data: buffer.toString('base64'),
            mimeType: mimeType.startsWith('video/') ? mimeType : 'video/mp4',
          },
        });
        console.log(`[Gemini] Video attached: ${name}`);
      } else if (buffer) {
        textPart.text +=
          `\n\nVideo terlalu besar — turunkan caption dari nama file & briefing, tetap spesifik.`;
      }
    } catch (err) {
      console.warn('[Gemini] Could not attach video:', err.message);
    }
  }

  const firstImage = images[0];
  if (firstImage && !videos.length) {
    try {
      let buffer;
      let mimeType = firstImage.mimeType || 'image/jpeg';
      if (firstImage.buffer) buffer = firstImage.buffer;
      else if (firstImage.id) {
        const dl = await downloadFile(firstImage.id);
        buffer = dl.buffer;
        mimeType = dl.mimeType;
      }
      if (buffer) {
        parts.push({
          inlineData: { data: buffer.toString('base64'), mimeType },
        });
      }
    } catch (err) {
      console.warn('[Gemini] Could not attach image:', err.message);
    }
  }

  return { parts, uniqueNets, missionBriefing };
}

/**
 * Generate caption berbeda per platform.
 * @param {{ folderName: string, mediaFiles: object[], targetNetworks?: string[], tone?: string, missionBriefing?: object }} context
 */
export async function generateCaptionsByNetwork(context) {
  const { parts, uniqueNets, missionBriefing } = await buildGeminiParts(context);
  const required = missionBriefing?.requiredHashtags || [];

  const raw = await callGemini(parts);
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
    console.warn('[Gemini] Multi-platform parse incomplete, fallback single caption');
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

  const { parts } = await buildGeminiParts(context);
  const raw = await callGemini(parts);
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
