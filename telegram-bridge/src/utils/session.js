import { getWibDayKey, nowIsoUtc } from './wibTime.js';

/** @typedef {'idle' | 'awaiting_drive_link' | 'awaiting_media' | 'awaiting_retry_media' | 'selecting_content' | 'selecting_folder' | 'ready' | 'selecting_targets' | 'selecting_accounts' | 'awaiting_caption_edit' | 'awaiting_schedule' | 'awaiting_status_id' | 'selecting_tone'} SessionStep */

/**
 * @typedef {object} MediaFile
 * @property {string} [id]
 * @property {Buffer} [buffer]
 * @property {string} name
 * @property {string} mimeType
 * @property {'drive' | 'telegram'} [source]
 */

/**
 * @typedef {import('./missionParse.js').MissionBriefing} MissionBriefing
 */

/**
 * @typedef {object} PublishSession
 * @property {SessionStep} step
 * @property {string} [driveRootId]
 * @property {string} [driveRootName]
 * @property {string} [folderId]
 * @property {string} [folderName]
 * @property {MediaFile[]} [mediaFiles]
 * @property {string} [mediaFilesSetAt] ISO UTC saat mediaFiles terakhir di-set; untuk anti-stale guard
 * @property {string} [mediaFilesDay] WIB day-key (YYYY-MM-DD) saat mediaFiles di-set
 * @property {string} [mediaSourceLabel] label sumber media (folder Drive name / "Telegram upload") untuk preview
 * @property {MissionBriefing} [missionBriefing]
 * @property {string} [caption]
 * @property {string[]} [selectedAccountIds]
 * @property {string} [targetLabel]
 * @property {Record<string, string>} [captionsByNetwork]
 * @property {{ title: string, description: string, tags?: string[] }} [youtubeFields]
 * @property {string} [scheduledAt]
 * @property {string[]} [outstandMediaIds]
 * @property {string[]} [outstandPostIds]
 * @property {string} [accountPickNetwork]
 * @property {string[]} [accountPickSelected]
 * @property {string} [captionTone]
 * @property {string} [retryAccountIdsWithWait]
 * @property {{ postIds?: string[], network?: string | null, retryIds?: string[], caption?: string }} [retryPending]
 * @property {{ usernamesByNetwork: Record<string, string[]>, postIds: string[], total: number, at: number }} [stuckSnapshot]
 * @property {object} [lastPublish]
 * @property {string} [usedAccountsTab] tab YYYY-MM-DD untuk usedAccountIdsToday
 * @property {string[]} [usedAccountIdsToday] akun sudah dipakai publish hari ini (sesi bot)
 */

const sessions = new Map();

/**
 * Default umur maksimum `session.mediaFiles` sebelum dianggap basi (jam).
 * Bisa di-override via env `SESSION_MEDIA_MAX_AGE_HOURS`.
 */
function getMediaMaxAgeHours() {
  const n = Number(process.env.SESSION_MEDIA_MAX_AGE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

/**
 * @param {number | string} chatId
 * @returns {PublishSession}
 */
export function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, { step: 'idle' });
  }
  return sessions.get(key);
}

/**
 * @param {number | string} chatId
 */
export function resetSession(chatId) {
  sessions.set(String(chatId), { step: 'idle' });
}

/**
 * @param {number | string} chatId
 * @param {Partial<PublishSession>} patch
 */
export function updateSession(chatId, patch) {
  const session = getSession(chatId);
  Object.assign(session, patch);
  sessions.set(String(chatId), session);
  return session;
}

/**
 * Set mediaFiles + tandai timestamp & day-key supaya anti-stale guard bisa
 * mendeteksi sesi basi. Selalu pakai fungsi ini untuk overwrite mediaFiles
 * supaya tidak ada code path yang bocor tanpa stempel.
 *
 * @param {number | string} chatId
 * @param {MediaFile[]} mediaFiles
 * @param {{ folderId?: string, folderName?: string, sourceLabel?: string, extra?: Partial<PublishSession> }} [meta]
 */
export function setSessionMediaFiles(chatId, mediaFiles, meta = {}) {
  return updateSession(chatId, {
    mediaFiles,
    mediaFilesSetAt: nowIsoUtc(),
    mediaFilesDay: getWibDayKey(),
    ...(meta.folderId !== undefined ? { folderId: meta.folderId } : {}),
    ...(meta.folderName !== undefined ? { folderName: meta.folderName } : {}),
    ...(meta.sourceLabel !== undefined
      ? { mediaSourceLabel: meta.sourceLabel }
      : meta.folderName !== undefined
        ? { mediaSourceLabel: meta.folderName }
        : {}),
    ...(meta.extra || {}),
  });
}

/**
 * Bersihkan field konten (mediaFiles + caption + target) tanpa menyentuh state
 * yang masih relevan lintas hari (mis. usedAccountIdsToday, stuckSnapshot).
 * @param {number | string} chatId
 */
export function clearSessionContent(chatId) {
  return updateSession(chatId, {
    mediaFiles: undefined,
    mediaFilesSetAt: undefined,
    mediaFilesDay: undefined,
    mediaSourceLabel: undefined,
    folderId: undefined,
    folderName: undefined,
    driveRootId: undefined,
    driveRootName: undefined,
    caption: undefined,
    captionsByNetwork: undefined,
    youtubeFields: undefined,
    selectedAccountIds: undefined,
    targetLabel: undefined,
    captionTone: undefined,
    outstandMediaIds: undefined,
  });
}

/**
 * Cek apakah `session.mediaFiles` masih layak dipakai untuk publish baru.
 * Return `null` kalau fresh, atau object detail kalau basi.
 *
 * @param {PublishSession} session
 * @param {{ maxAgeHours?: number, currentDayKey?: string }} [opts]
 * @returns {null | { reason: 'no-media' | 'day-changed' | 'too-old' | 'no-timestamp', ageHours?: number, prevDay?: string, todayDay?: string, setAt?: string }}
 */
export function getStaleMediaReason(session, opts = {}) {
  if (!session?.mediaFiles?.length) {
    return { reason: 'no-media' };
  }
  const todayDay = opts.currentDayKey || getWibDayKey();
  const maxAgeHours = opts.maxAgeHours ?? getMediaMaxAgeHours();

  if (!session.mediaFilesSetAt) {
    // Session lama (mungkin dari versi sebelum patch ini): treat as stale supaya
    // user dipaksa /publish ulang minimal sekali untuk re-stamp.
    return { reason: 'no-timestamp' };
  }

  if (session.mediaFilesDay && session.mediaFilesDay !== todayDay) {
    return {
      reason: 'day-changed',
      prevDay: session.mediaFilesDay,
      todayDay,
      setAt: session.mediaFilesSetAt,
    };
  }

  const setAtMs = new Date(session.mediaFilesSetAt).getTime();
  if (Number.isFinite(setAtMs)) {
    const ageHours = (Date.now() - setAtMs) / 3_600_000;
    if (ageHours > maxAgeHours) {
      return {
        reason: 'too-old',
        ageHours,
        setAt: session.mediaFilesSetAt,
        todayDay,
      };
    }
  }

  return null;
}
