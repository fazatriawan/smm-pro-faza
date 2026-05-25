/**
 * Prisma client wrapper — lazy + safe.
 *
 * Status Phase 0:
 *  - File ini BELUM diimport runtime di entry point.
 *  - Kalau `@prisma/client` belum di-install, `getPrisma()` throw error
 *    yang mudah dibaca (bukan ER_MODULE_NOT_FOUND mentah).
 *  - Setelah Phase 1 aktif: import dari sini, JANGAN `new PrismaClient()`
 *    di tempat lain (supaya cuma satu pool koneksi DB).
 *
 * ENV:
 *  - DATABASE_URL=postgres://user:pass@host:5432/db
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('db:prisma');

/** @type {any} */
let prismaInstance = null;

/** @type {Promise<any> | null} */
let initPromise = null;

async function initPrisma() {
  try {
    const mod = await import('@prisma/client');
    const PrismaClient = mod.PrismaClient || mod.default?.PrismaClient;
    if (!PrismaClient) {
      throw new Error('PrismaClient export not found in @prisma/client');
    }
    prismaInstance = new PrismaClient({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });

    prismaInstance.$on?.('warn', (e) => log.warn({ target: e?.target }, e?.message));
    prismaInstance.$on?.('error', (e) => log.error({ target: e?.target }, e?.message));

    await prismaInstance.$connect();
    log.info('Prisma connected');
    return prismaInstance;
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes("Cannot find package '@prisma/client'") || err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        'Prisma client belum ter-install. Jalankan:\n' +
          '  cd telegram-bridge && npm install @prisma/client && npx prisma generate\n' +
          '(lihat docs/MIGRATION.md "Phase 1 activation runbook")',
      );
    }
    throw err;
  }
}

/**
 * Ambil instance Prisma (lazy init, single-instance per process).
 * @returns {Promise<any>}
 */
export async function getPrisma() {
  if (prismaInstance) return prismaInstance;
  if (!initPromise) initPromise = initPrisma();
  return initPromise;
}

/** Tutup koneksi DB saat shutdown. */
export async function closePrisma() {
  if (!prismaInstance) return;
  try {
    await prismaInstance.$disconnect();
    log.info('Prisma disconnected');
  } catch (err) {
    log.warn({ err: err?.message }, `Prisma disconnect: ${err?.message}`);
  } finally {
    prismaInstance = null;
    initPromise = null;
  }
}

/** Probe ringan untuk healthz. */
export async function pingPrisma() {
  const t0 = Date.now();
  try {
    const prisma = await getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: err?.message || String(err) };
  }
}
