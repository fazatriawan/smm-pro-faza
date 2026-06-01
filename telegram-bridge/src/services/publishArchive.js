import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getWibDayKey } from '../utils/wibTime.js';

const archiveDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/publish-archives'
);

/**
 * @param {string | number} chatId
 */
function chatArchivePath(chatId) {
  return path.join(archiveDir, `${chatId}.json`);
}

/**
 * @param {object} snapshot
 */
function sanitizeSnapshot(snapshot) {
  if (!snapshot) return null;

  /** @type {Array<{ id?: string, name: string, mimeType: string, source?: string }>} */
  const mediaFiles = (snapshot.mediaFiles || [])
    .map((f) => ({
      id: f.id,
      name: f.name || 'media',
      mimeType: f.mimeType || 'application/octet-stream',
      source: f.source || (f.id ? 'drive' : 'telegram'),
    }))
    .filter((f) => f.id);

  return {
    savedAt: snapshot.savedAt || new Date().toISOString(),
    mediaFilesDay: snapshot.mediaFilesDay || getWibDayKey(snapshot.savedAt),
    caption: snapshot.caption || '',
    folderName: snapshot.folderName || '',
    folderId: snapshot.folderId || '',
    targetLabel: snapshot.targetLabel || '',
    postIds: [...new Set((snapshot.postIds || []).filter(Boolean))],
    selectedAccountIds: [
      ...new Set((snapshot.selectedAccountIds || []).filter(Boolean)),
    ],
    mediaFiles,
  };
}

/**
 * Simpan publish terakhir ke disk (tahan bot restart / timeout).
 * @param {string | number} chatId
 * @param {object} snapshot
 */
export function savePublishArchive(chatId, snapshot) {
  const clean = sanitizeSnapshot(snapshot);
  if (!clean) return;
  if (!clean.postIds.length && !clean.mediaFiles.length && !clean.folderId) {
    return;
  }

  fs.mkdirSync(archiveDir, { recursive: true });

  let byPostId = {};
  try {
    const prev = loadPublishArchiveStore(chatId);
    byPostId = prev?.byPostId || {};
  } catch {
    /* fresh */
  }

  for (const pid of clean.postIds) {
    byPostId[pid] = clean;
  }

  fs.writeFileSync(
    chatArchivePath(chatId),
    JSON.stringify({ latest: clean, byPostId }, null, 2),
    'utf8'
  );
}

/**
 * @param {string | number} chatId
 */
function loadPublishArchiveStore(chatId) {
  const p = chatArchivePath(chatId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {string | number} chatId
 * @param {string} [postId]
 */
export function loadPublishArchive(chatId, postId) {
  const store = loadPublishArchiveStore(chatId);
  if (!store) return null;
  if (postId && store.byPostId?.[postId]) {
    return store.byPostId[postId];
  }
  return store.latest || null;
}

/**
 * Muat ulang media dari arsip (Drive id atau folderId).
 * @param {ReturnType<typeof loadPublishArchive>} archive
 */
export async function hydrateMediaFromArchive(archive) {
  if (!archive) return null;

  if (archive.mediaFiles?.length) {
    return archive.mediaFiles.map((f) => ({
      id: f.id,
      name: f.name || 'media',
      mimeType: f.mimeType || 'application/octet-stream',
      source: 'drive',
    }));
  }

  // Jangan re-list seluruh folder Drive — folder sering berisi file beberapa hari
  // dan akan meng-upload konten kemarin lagi. Paksa user kirim link Drive baru.
  return null;
}

/**
 * Apakah arsip publish dari hari WIB sebelumnya (tidak boleh dipakai retry otomatis).
 * @param {ReturnType<typeof loadPublishArchive>} archive
 */
export function getArchiveStaleReason(archive) {
  if (!archive) return { reason: 'no-archive' };
  const today = getWibDayKey();
  const savedDay =
    archive.mediaFilesDay || getWibDayKey(archive.savedAt || '');
  if (savedDay && savedDay !== today) {
    return { reason: 'day-changed', prevDay: savedDay, todayDay: today };
  }
  return null;
}
