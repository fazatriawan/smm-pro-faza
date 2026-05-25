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
