/**
 * Structured logger (Pino) dengan fallback aman ke `console.*`.
 *
 * Tujuan Phase 0:
 * - Bot tetap jalan walaupun pino belum di-`npm install` (fallback otomatis).
 * - Drop-in API: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`.
 * - Mendukung `logger.child({ component: 'sheets' })` untuk konteks per modul.
 *
 * Setelah `npm install` di VPS, otomatis pakai Pino (JSON structured logs)
 * yang siap dialirkan ke file / Loki / Datadog tanpa ubah call-site.
 *
 * Cara pakai:
 *   import { createLogger } from '../utils/logger.js';
 *   const log = createLogger('sheets');
 *   log.info({ tab: '2026-05-26', rows: 105 }, 'rewrite tab selesai');
 *
 * ENV:
 *   LOG_LEVEL=debug|info|warn|error  (default: info)
 *   LOG_PRETTY=1                     (paksa pretty output saat dev)
 */

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

const desiredLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LOG_LEVELS[desiredLevel] ?? LOG_LEVELS.info;
const wantPretty =
  process.env.LOG_PRETTY === '1' || process.env.NODE_ENV !== 'production';

/** @type {any} */
let pinoInstance = null;

async function tryLoadPino() {
  try {
    const mod = await import('pino');
    const pino = mod.default || mod;

    let transport;
    if (wantPretty) {
      try {
        await import('pino-pretty');
        transport = {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        };
      } catch {
        transport = undefined;
      }
    }

    pinoInstance = pino({
      level: desiredLevel,
      base: { service: 'smm-telegram-bridge' },
      ...(transport ? { transport } : {}),
    });
    return true;
  } catch {
    pinoInstance = null;
    return false;
  }
}

const initPromise = tryLoadPino();

function fallbackEmit(level, bindings, args) {
  if ((LOG_LEVELS[level] ?? 99) < minLevel) return;
  const time = new Date().toISOString();
  const prefix = bindings?.component ? `[${bindings.component}]` : '';
  const tag = `${time} ${level.toUpperCase()}${prefix ? ' ' + prefix : ''}`;

  let payload;
  let message;
  if (typeof args[0] === 'object' && args[0] !== null) {
    payload = args[0];
    message = args[1];
  } else {
    message = args[0];
  }

  const out = level === 'error' || level === 'fatal' ? console.error : console.log;
  if (payload && Object.keys(payload).length > 0) {
    out(`${tag} ${message ?? ''}`, payload);
  } else {
    out(`${tag} ${message ?? ''}`);
  }
}

function makeLogger(bindings = {}) {
  const emit = (level) => (...args) => {
    if (pinoInstance) {
      const child = Object.keys(bindings).length
        ? pinoInstance.child(bindings)
        : pinoInstance;
      child[level](...args);
    } else {
      fallbackEmit(level, bindings, args);
    }
  };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    child(extra = {}) {
      return makeLogger({ ...bindings, ...extra });
    },
    /** Tunggu sampai underlying logger siap (mis. saat boot). */
    ready() {
      return initPromise;
    },
  };
}

/**
 * @param {string | { component?: string, [k: string]: any }} bindingsOrComponent
 */
export function createLogger(bindingsOrComponent = {}) {
  const bindings =
    typeof bindingsOrComponent === 'string'
      ? { component: bindingsOrComponent }
      : bindingsOrComponent || {};
  return makeLogger(bindings);
}

/** Root logger default (tanpa binding). */
export const logger = makeLogger();

export default logger;
