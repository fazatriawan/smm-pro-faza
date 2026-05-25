import { Readable } from 'stream';
import { getDriveClient } from '../config/google.js';
import { env } from '../config/env.js';
import { getRuntime, setRuntime } from '../utils/runtimeStore.js';
import { parseDriveId } from '../utils/driveId.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MEDIA_QUERY =
  "(mimeType contains 'image/' or mimeType contains 'video/') and trashed = false";

/**
 * Parent folder for bank konten (stable ID — tidak pakai link share harian).
 */
export function getDriveParentId() {
  const override = getRuntime('driveParentId');
  if (override) return parseDriveId(override);

  const fromEnv =
    parseDriveId(env.googleDriveFolderId) ||
    parseDriveId(env.googleDriveParentId);
  return fromEnv;
}

/**
 * @param {string} parentId
 */
async function listSubFoldersInParent(parentId) {
  const drive = getDriveClient();
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ');

  const res = await drive.files.list({
    q,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files ?? [];
}

/**
 * Nama folder yang mungkin dipakai per hari (Asia/Jakarta).
 */
function todayFolderNameCandidates() {
  const tz = env.timezone;
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(now)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, /** @type {Record<string,string>} */ ({}));

  const y = parts.year;
  const m = parts.month;
  const d = parts.day;

  return [
    `${y}-${m}-${d}`,
    `${d}-${m}-${y}`,
    `${d}/${m}/${y}`,
    `${d}.${m}.${y}`,
    `${y}${m}${d}`,
  ];
}

/**
 * Mode harian: folder terbaru atau nama cocok tanggal hari ini.
 * @param {Awaited<ReturnType<typeof listSubFoldersInParent>>} folders
 */
function pickDailyFolder(folders) {
  if (!folders.length) return null;

  if (env.googleDriveDailyMode === 'latest') {
    return folders[0];
  }

  if (env.googleDriveDailyMode === 'date') {
    const candidates = new Set(
      todayFolderNameCandidates().map((s) => s.toLowerCase())
    );
    const match = folders.find((f) =>
      candidates.has((f.name || '').trim().toLowerCase())
    );
    return match || folders[0];
  }

  return null;
}

export async function getFolderMeta(folderId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  return res.data;
}

/**
 * Buka link/ID Drive: folder → isi subfolder + media; file tunggal → 1 media.
 * @param {string} urlOrId
 */
export async function resolveDriveEntry(urlOrId) {
  const id = parseDriveId(urlOrId);
  if (!id) throw new Error('Link Google Drive tidak valid');

  const meta = await getFolderMeta(id);
  const isFolder = meta.mimeType === FOLDER_MIME;

  if (!isFolder) {
    return {
      id,
      name: meta.name || 'Konten',
      isFolder: false,
      subfolders: [],
      media: [
        {
          id: meta.id,
          name: meta.name,
          mimeType: meta.mimeType,
        },
      ],
    };
  }

  const [subfolders, media] = await Promise.all([
    listSubFoldersInParent(id),
    listMediaInFolder(id),
  ]);

  return {
    id,
    name: meta.name || 'Folder',
    isFolder: true,
    subfolders,
    media,
  };
}

/**
 * List sub-folders for /publish keyboard (legacy .env parent).
 */
export async function listSubFolders() {
  const parentId = getDriveParentId();
  if (!parentId) {
    throw new Error(
      'Folder Drive belum diset. Kirim link folder ke bot atau isi GOOGLE_DRIVE_PARENT_FOLDER_ID di .env'
    );
  }
  return listSubFoldersInParent(parentId);
}

/**
 * Auto-resolve folder konten hari ini (mode latest / date).
 */
export async function resolveTodayContentFolder() {
  const folders = await listSubFolders();
  const picked = pickDailyFolder(folders);
  if (!picked) return null;
  return {
    id: picked.id,
    name: picked.name,
    mode: env.googleDriveDailyMode,
  };
}

/**
 * Simpan parent folder dari link Telegram (/setdrive).
 * @param {string} urlOrId
 */
export function saveDriveParentFromInput(urlOrId) {
  const id = parseDriveId(urlOrId);
  if (!id) throw new Error('Link/ID Google Drive tidak valid');
  setRuntime('driveParentId', id);
  return id;
}

/**
 * List image/video files inside a Drive folder.
 * @param {string} folderId
 */
export async function listMediaInFolder(folderId) {
  const drive = getDriveClient();
  const q = [`'${folderId}' in parents`, MEDIA_QUERY].join(' and ');

  const res = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    orderBy: 'name',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files ?? [];
}

/**
 * Download file bytes via Drive API (file ID stabil — bukan link share harian).
 * @param {string} fileId
 */
export async function downloadFile(fileId) {
  const drive = getDriveClient();

  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );

  return {
    buffer: Buffer.from(res.data),
    mimeType: meta.data.mimeType || 'application/octet-stream',
    name: meta.data.name || 'media',
  };
}

export async function downloadFileStream(fileId) {
  const drive = getDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );

  return {
    stream: /** @type {Readable} */ (res.data),
    mimeType: meta.data.mimeType || 'application/octet-stream',
    name: meta.data.name || 'media',
  };
}
