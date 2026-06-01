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

/**
 * Kirim message via `telegram.sendMessage` (bukan `ctx.reply`) dengan fallback
 * plain text kalau Markdown parser Telegram crash (mis. URL berisi `_` yang
 * dianggap italic). Berguna untuk follow-up poller, scheduler, broadcast, dll
 * yang tidak punya akses langsung ke `ctx.reply`.
 *
 * @param {import('telegraf').Telegram} telegram
 * @param {number | string} chatId
 * @param {string} text
 * @param {object} [extra]
 */
export async function safeSendMessage(telegram, chatId, text, extra = {}) {
  if (extra.parse_mode === 'Markdown' || extra.parse_mode === 'MarkdownV2') {
    try {
      await telegram.sendMessage(chatId, text, extra);
      return;
    } catch (err) {
      const msg = String(err?.message || err);
      if (!msg.includes("can't parse entities")) throw err;
      console.warn(
        '[Telegram] Markdown sendMessage failed, falling back to plain:',
        msg
      );
    }
  }
  const plain = text.replace(/\\/g, '');
  await telegram.sendMessage(chatId, plain, {
    ...extra,
    parse_mode: undefined,
  });
}
