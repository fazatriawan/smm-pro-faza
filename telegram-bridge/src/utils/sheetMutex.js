/** @type {Map<string, Promise<unknown>>} */
const tails = new Map();

/**
 * Serialize Google Sheets mutations per spreadsheet to avoid `_conflict` tab races.
 * @template T
 * @param {string} spreadsheetId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSheetLock(spreadsheetId, fn) {
  const key = String(spreadsheetId || '__default__');
  const prev = tails.get(key) || Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(fn)
    .finally(() => {
      if (tails.get(key) === run) tails.delete(key);
    });
  tails.set(key, run);
  return run;
}
