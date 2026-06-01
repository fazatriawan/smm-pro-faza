import { getDriveClient, getSheetsClient } from '../config/google.js';
import { env } from '../config/env.js';
import { getRuntime, setRuntime } from '../utils/runtimeStore.js';
import { getWideBaseHeaderRow, columnLetterFromIndex } from '../config/sheetLayout.js';

let cachedSpreadsheetId = null;

const SPREADSHEET_PLACEHOLDERS = new Set([
  'your_spreadsheet_id',
  'your_spreadsheet_id_here',
]);

function isValidSpreadsheetId(id) {
  if (!id || typeof id !== 'string') return false;
  const s = id.trim();
  if (SPREADSHEET_PLACEHOLDERS.has(s.toLowerCase())) return false;
  return /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

/**
 * Resolve spreadsheet ID: .env → runtime file → auto-create new sheet.
 */
export async function getSpreadsheetId() {
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  if (isValidSpreadsheetId(env.googleSpreadsheetId)) {
    cachedSpreadsheetId = env.googleSpreadsheetId.trim();
    return cachedSpreadsheetId;
  }

  const stored = getRuntime('spreadsheetId');
  if (isValidSpreadsheetId(stored)) {
    cachedSpreadsheetId = stored.trim();
    return cachedSpreadsheetId;
  }

  const created = await createPublishLogSpreadsheet();
  setRuntime('spreadsheetId', created.id);
  cachedSpreadsheetId = created.id;
  console.log(`[Sheets] Auto-created spreadsheet: ${created.url}`);
  return created.id;
}

export function getSpreadsheetUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function createPublishLogSpreadsheet() {
  const sheets = getSheetsClient();
  const title = `SMM Pro Publish Log ${new Date().toISOString().slice(0, 10)}`;

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: env.googleSheetTab } }],
    },
  });

  const id = res.data.spreadsheetId;
  if (!id) throw new Error('Gagal membuat spreadsheet otomatis');

  const header = getWideBaseHeaderRow();
  const lastCol = columnLetterFromIndex(header.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${env.googleSheetTab}!A1:${lastCol}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header] },
  });

  if (env.googleSheetShareEmail) {
    const drive = getDriveClient();
    await drive.permissions.create({
      fileId: id,
      supportsAllDrives: true,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: env.googleSheetShareEmail,
      },
    });
  }

  return { id, url: getSpreadsheetUrl(id), title };
}

export async function ensureSpreadsheetReady() {
  const id = await getSpreadsheetId();
  return { id, url: getSpreadsheetUrl(id) };
}
