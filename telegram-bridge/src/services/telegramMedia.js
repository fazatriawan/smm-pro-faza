import axios from 'axios';

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} fileId
 */
export async function downloadTelegramFile(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  if (!file.file_path) {
    throw new Error('Telegram tidak mengembalikan path file.');
  }
  const url = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 300_000,
    maxContentLength: Infinity,
  });
  return Buffer.from(res.data);
}

/**
 * @param {import('telegraf').Context} ctx
 */
export function pickLargestPhotoFileId(ctx) {
  const photos = ctx.message?.photo;
  if (!photos?.length) return null;
  return photos[photos.length - 1].file_id;
}

/**
 * @param {import('telegraf').Context} ctx
 * @returns {{ fileId: string, name: string, mimeType: string } | null}
 */
export function extractTelegramMedia(ctx) {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      name: msg.video.file_name || `video_${msg.video.file_unique_id}.mp4`,
      mimeType: msg.video.mime_type || 'video/mp4',
    };
  }

  if (msg.document) {
    const mime = msg.document.mime_type || '';
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      return null;
    }
    return {
      fileId: msg.document.file_id,
      name: msg.document.file_name || 'document',
      mimeType: mime,
    };
  }

  const photoId = pickLargestPhotoFileId(ctx);
  if (photoId) {
    return {
      fileId: photoId,
      name: `photo_${msg.message_id}.jpg`,
      mimeType: 'image/jpeg',
    };
  }

  return null;
}
