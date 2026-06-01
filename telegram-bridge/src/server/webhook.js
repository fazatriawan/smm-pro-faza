import crypto from 'crypto';
import express from 'express';
import { env } from '../config/env.js';
import { recordWebhookToSheet } from '../services/sheets.js';
import { getBot, getNotifyChat } from '../services/bot.js';
import { createLogger } from '../utils/logger.js';
import { hashWebhookBody, markIfNew } from '../utils/webhookDedup.js';

const log = createLogger('webhook');

/**
 * @param {import('express').Request} req
 * @param {string} rawBody
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyOutstandSignature(req, rawBody) {
  const secret = env.outstandWebhookSecret;
  if (!secret) {
    return { ok: true, reason: 'no-secret-configured' };
  }

  const signature = req.headers['x-outstand-signature'];
  if (!signature || typeof signature !== 'string') {
    return { ok: false, reason: 'missing-header' };
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
    return ok
      ? { ok: true }
      : { ok: false, reason: 'signature-mismatch' };
  } catch {
    return { ok: false, reason: 'buffer-length-mismatch' };
  }
}

export function createWebhookApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'smm-telegram-bridge' });
  });

  app.post(
    '/webhook/outstand',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const rawBody =
        typeof req.body === 'string'
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : '';

      const verdict = verifyOutstandSignature(req, rawBody);
      if (!verdict.ok) {
        log.warn(
          {
            reason: verdict.reason,
            ip: req.ip,
            hasHeader: Boolean(req.headers['x-outstand-signature']),
            secretConfigured: Boolean(env.outstandWebhookSecret),
          },
          `[Webhook] signature verification failed: ${verdict.reason}`,
        );
        return res.status(401).send('Invalid signature');
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || '{}');
      } catch {
        log.warn({ ip: req.ip }, '[Webhook] invalid JSON body');
        return res.status(400).send('Invalid JSON');
      }

      const dedupKey = hashWebhookBody(rawBody);
      const isNew = markIfNew(dedupKey);

      res.status(200).send('OK');

      if (!isNew) {
        log.info(
          {
            event: payload?.event,
            postId: payload?.data?.postId,
            dedupKey: dedupKey.slice(0, 12),
          },
          '[Webhook] duplicate retry ignored',
        );
        return;
      }

      log.info(
        {
          event: payload?.event,
          postId: payload?.data?.postId,
          accounts: Array.isArray(payload?.data?.socialAccounts)
            ? payload.data.socialAccounts.length
            : undefined,
        },
        `[Webhook] received ${payload?.event}`,
      );

      setImmediate(async () => {
        try {
          const notifyChatId = getNotifyChat('default');
          const bot = getBot();

          const notify = async (text) => {
            if (bot && notifyChatId) {
              await bot.telegram.sendMessage(notifyChatId, text);
            }
          };

          await recordWebhookToSheet(payload, notify);
        } catch (err) {
          log.error(
            { err: err?.message, stack: err?.stack },
            `[Webhook] processing error: ${err?.message || err}`,
          );
        }
      });
    },
  );

  return app;
}
