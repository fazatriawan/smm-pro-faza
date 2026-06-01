import { env } from '../config/env.js';

/**
 * Parse jadwal natural (WIB) atau ISO.
 * @param {string} text
 * @returns {Date | null}
 */
export function parseScheduleInput(text) {
  const raw = (text || '').trim().toLowerCase();
  if (!raw) return null;

  const iso = new Date(text);
  if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return iso;
  }

  const now = new Date();

  const relHour = raw.match(/^\+(\d+)\s*(jam|h|hours?)?$/);
  if (relHour) {
    return new Date(now.getTime() + Number(relHour[1]) * 3_600_000);
  }

  const relMin = raw.match(/^\+(\d+)\s*(menit|mnt|m|min)$/);
  if (relMin) {
    return new Date(now.getTime() + Number(relMin[1]) * 60_000);
  }

  if (raw === 'besok' || raw.startsWith('besok ')) {
    const timePart = raw.replace(/^besok\s*/, '').trim();
    const { hour, minute } = parseClock(timePart || '09:00');
    return zonedLocalToUtc(addDaysWib(1), hour, minute);
  }

  const dm = raw.match(
    /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?(?:\s+(\d{1,2})(?::(\d{2}))?)?$/
  );
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const { hour, minute } = parseClock(
      dm[4] !== undefined ? `${dm[4]}:${dm[5] || '00'}` : '09:00'
    );
    return zonedLocalToUtc({ year, month, day }, hour, minute);
  }

  return null;
}

function parseClock(s) {
  const m = (s || '09:00').match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return { hour: 9, minute: 0 };
  return { hour: Number(m[1]), minute: Number(m[2] || 0) };
}

function getWibParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = Number(p.value);
      return acc;
    }, /** @type {Record<string, number>} */ ({}));
  return parts;
}

function addDaysWib(days) {
  const future = new Date(Date.now() + days * 86_400_000);
  return getWibParts(future);
}

/** Approximate: WIB = UTC+7 */
function zonedLocalToUtc(
  { year, month, day },
  hour,
  minute
) {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, 0));
}

export function formatScheduleHelp() {
  return (
    'Format jadwal:\n' +
    '• `+3 jam` / `+30 menit`\n' +
    '• `besok 09:00`\n' +
    '• `21/05 14:30` atau `21/05/2026 14:30`\n' +
    '• ISO: `2026-05-22T06:30:00Z`'
  );
}
