import { env } from '../config/env.js';
import { isFfmpegAvailable } from './imageToVideo.js';
import { networksNeedingImageToVideo } from './imageToVideo.js';
import { listSocialAccounts } from './outstand.js';

/**
 * @param {{ mediaFiles: Array<{ name: string, mimeType: string }>, selectedAccountIds: string[] }} input
 */
export async function validateBeforePublish({ mediaFiles, selectedAccountIds }) {
  const warnings = [];
  const errors = [];

  const accounts = await listSocialAccounts();
  const useCount = new Map();
  for (const id of selectedAccountIds) {
    useCount.set(id, (useCount.get(id) || 0) + 1);
  }
  for (const [id, count] of useCount) {
    if (count > 2) {
      const acc = accounts.find((a) => a.id === id);
      const user = (acc?.username || id).replace(/^@/, '');
      errors.push(`@${user} dipilih ${count}× dalam satu publish (maks 2×).`);
    }
  }

  const uniqueIds = [...useCount.keys()];
  const selected = accounts.filter((a) => uniqueIds.includes(a.id));
  const networks = [
    ...new Set(selected.map((a) => (a.network || '').toLowerCase())),
  ];

  const hasVideo = mediaFiles.some((f) => f.mimeType?.startsWith('video/'));
  const hasImage = mediaFiles.some((f) => f.mimeType?.startsWith('image/'));
  const convertNets = networksNeedingImageToVideo(networks, hasVideo, hasImage);

  if (!mediaFiles.length) {
    errors.push('Tidak ada file media.');
  }

  if (convertNets.length && hasImage) {
    if (!(await isFfmpegAvailable())) {
      errors.push(
        'ffmpeg belum terpasang — diperlukan untuk gambar→video (IG/Threads/FB/YT).'
      );
    }
    if (!env.imageToVideoAudioPath && !env.imageToVideoAllowSilent) {
      errors.push('Tidak ada file musik di assets/audio/ (IMAGE_TO_VIDEO_AUDIO_PATH).');
    } else if (!env.imageToVideoAudioPath) {
      warnings.push('Video akan dibuat tanpa musik (silent).');
    }
  }

  for (const f of mediaFiles) {
    if (f.mimeType?.startsWith('image/') && networks.includes('youtube') && !convertNets.includes('youtube')) {
      /* youtube in convert list */
    }
  }

  const maxMb = env.maxDriveFileMb;
  if (maxMb > 0) {
    warnings.push(`Pastikan file di Drive < ${maxMb} MB (batas konfigurasi).`);
  }

  if (!selected.length) {
    errors.push('Tidak ada akun target valid.');
  }

  return { ok: errors.length === 0, errors, warnings, convertNets };
}

/**
 * @param {{ mediaFiles: Array<{ name: string, mimeType: string }>, selectedAccountIds: string[], targetLabel?: string, caption?: string }} session
 */
export function buildPublishPreviewText(session) {
  const lines = ['📋 *Pratinjau sebelum publish*', ''];

  const kind = session.mediaFiles?.some((f) => f.mimeType?.startsWith('video/'))
    ? '🎬 Video'
    : '🖼 Gambar';
  lines.push(`${kind}: ${session.mediaFiles?.map((f) => f.name).join(', ') || '—'}`);
  lines.push(`Target: ${session.targetLabel || '—'}`);

  const nets = (session.selectedAccountIds || []).length
    ? 'lihat target'
    : '';
  if (session.caption) {
    const prev = session.caption.slice(0, 200);
    lines.push(`Caption: ${prev}${session.caption.length > 200 ? '…' : ''}`);
  }

  return lines.join('\n');
}
