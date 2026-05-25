/**
 * Escape teks agar aman untuk Telegram parse_mode Markdown (legacy).
 * @param {string} text
 */
export function escapeMarkdown(text) {
  return (text || '').replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {object} [extra]
 */
export async function safeReply(ctx, text, extra = {}) {
  if (extra.parse_mode === 'Markdown') {
    try {
      await ctx.reply(text, extra);
      return;
    } catch (err) {
      console.warn('[Bot] Markdown reply failed, using plain:', err.message);
    }
  }
  const plain = text.replace(/\\/g, '');
  await ctx.reply(plain, { ...extra, parse_mode: undefined });
}
