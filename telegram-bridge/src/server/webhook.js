import crypto from 'crypto';
import express from 'express';
import { env } from '../config/env.js';
import { recordWebhookToSheet } from '../services/sheets.js';
import { getBot, getNotifyChat } from '../services/bot.js';

/**
 * @param {import('express').Request} req
 * @param {string} rawBody
 */
function verifyOutstandSignature(req, rawBody) {
  const secret = env.outstandWebhookSecret;
  if (!secret) return true;

  const signature = req.headers['x-outstand-signature'];
  if (!signature || typeof signature !== 'string') return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
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

      if (!verifyOutstandSignature(req, rawBody)) {
        return res.status(401).send('Invalid signature');
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || '{}');
      } catch {
        return res.status(400).send('Invalid JSON');
      }

      res.status(200).send('OK');

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
          console.error('[Webhook] processing error:', err);
        }
      });
    }
  );

  return app;
}
