import { env } from '../config/env.js';

/**
 * Rencana polling status setelah publish ke Outstand.
 * Batch besar: poll singkat dulu, sisanya webhook + refresh Sheets terjadwal.
 * @param {number} accountCount
 */
export function computePublishPollPlan(accountCount) {
  const count = Math.max(0, accountCount || 0);
  const fullEstimateMs = Math.min(
    env.publishPollMaxMs,
    env.publishPollMinMs + count * env.publishPollPerAccountMs
  );
  const largeBatch = count >= env.publishLargeBatchThreshold;
  const maxWaitMs = largeBatch
    ? Math.min(env.publishLargeBatchPollMs, fullEstimateMs)
    : fullEstimateMs;

  return {
    accountCount: count,
    maxWaitMs,
    largeBatch,
    fullEstimateMs,
    displaySeconds: Math.round(maxWaitMs / 1000),
  };
}

/**
 * @param {number} accountCount
 */
export function formatPollWaitHint(accountCount) {
  const plan = computePublishPollPlan(accountCount);
  if (plan.largeBatch) {
    return (
      `±${plan.displaySeconds} detik (batch besar — sisanya via webhook & refresh Sheets)`
    );
  }
  return `±${plan.displaySeconds} detik`;
}

/**
 * @param {{ pending: number, failed: number, published: number }} summary
 * @param {{ accountCount: number, largeBatch: boolean }} plan
 * @param {string} postIdLine
 */
export function formatLargeBatchFollowUp(summary, plan, postIdLine) {
  if (!plan.largeBatch || summary.pending <= 0) return '';

  return (
    `\n\n📦 *Batch besar* (${plan.accountCount} akun)\n` +
    `⏳ *${summary.pending}* akun masih pending — normal untuk IG/Threads (Outstand proses antrian).\n` +
    `Sheets diperbarui otomatis +5 / +15 / +30 menit.\n` +
    (postIdLine ? `Cek link nanti: \`/links ${postIdLine}\`` : 'Cek link nanti: /links')
  );
}
