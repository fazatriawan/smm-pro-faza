import { getSheetsClient } from '../config/google.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sheet-conflict');

const CONFLICT_TAB_RE = /^(.+)_conflict\d+$/;

/**
 * @param {string} title
 */
export function parseConflictTabTitle(title) {
  const t = String(title || '').trim();
  const m = t.match(CONFLICT_TAB_RE);
  if (!m) return null;
  return { conflictTitle: t, baseTitle: m[1] };
}

/**
 * @param {Array<{ properties?: { sheetId?: number, title?: string } }>} sheets
 */
export function findConflictTabs(sheets) {
  const list = sheets || [];
  /** @type {Array<{ sheetId: number, conflictTitle: string, baseTitle: string }>} */
  const conflicts = [];

  for (const sheet of list) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title == null || sheetId == null) continue;
    const parsed = parseConflictTabTitle(title);
    if (!parsed) continue;
    conflicts.push({
      sheetId,
      conflictTitle: parsed.conflictTitle,
      baseTitle: parsed.baseTitle,
    });
  }

  return conflicts;
}

/**
 * Remove or rename orphaned `_conflict*` tabs after Google Sheets sync races.
 * @param {string} spreadsheetId
 * @param {{ tabName?: string }} [options] tabName = only resolve conflicts for this base tab
 */
export async function resolveConflictTabs(spreadsheetId, options = {}) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const allSheets = meta.data.sheets || [];
  const titles = new Set(
    allSheets.map((s) => s.properties?.title).filter(Boolean)
  );

  let conflicts = findConflictTabs(allSheets);
  if (options.tabName) {
    const base = String(options.tabName).trim();
    conflicts = conflicts.filter((c) => c.baseTitle === base);
  }
  if (!conflicts.length) return { resolved: 0, renamed: 0, deleted: 0 };

  /** @type {import('googleapis').sheets_v4.Schema$Request[]} */
  const requests = [];
  let renamed = 0;
  let deleted = 0;

  for (const conflict of conflicts) {
    if (titles.has(conflict.baseTitle)) {
      requests.push({
        deleteSheet: { sheetId: conflict.sheetId },
      });
      deleted += 1;
      log.info(
        { base: conflict.baseTitle, conflict: conflict.conflictTitle },
        `[Sheets] Hapus tab conflict: ${conflict.conflictTitle}`,
      );
      continue;
    }

    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: conflict.sheetId,
          title: conflict.baseTitle,
        },
        fields: 'title',
      },
    });
    titles.add(conflict.baseTitle);
    renamed += 1;
    log.info(
      { base: conflict.baseTitle, conflict: conflict.conflictTitle },
      `[Sheets] Rename tab conflict → ${conflict.baseTitle}`,
    );
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  return { resolved: requests.length, renamed, deleted };
}

/**
 * @param {string} spreadsheetId
 */
export async function cleanupAllConflictTabs(spreadsheetId) {
  return resolveConflictTabs(spreadsheetId);
}
