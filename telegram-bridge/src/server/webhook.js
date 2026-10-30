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

/**
 * Verifikasi signature webhook PostForme.
 * PostForme kirim secret langsung di header `post-for-me-webhook-secret`.
 * Fallback: Svix format (whsec_<base64key>) jika header Svix tersedia.
 */
function verifyPostformeSignature(req, rawBody) {
  const secret = env.postformeWebhookSecret;
  if (!secret) return { ok: true, reason: 'no-secret-configured' };

  // PostForme: cek header `post-for-me-webhook-secret` langsung
  const directSecret = req.headers['post-for-me-webhook-secret'];
  if (directSecret) {
    try {
      const valid = crypto.timingSafeEqual(Buffer.from(directSecret), Buffer.from(secret));
      return valid ? { ok: true } : { ok: false, reason: 'secret-mismatch' };
    } catch {
      return { ok: false, reason: 'secret-mismatch' };
    }
  }

  // Fallback: Svix format
  const msgId = req.headers['svix-id'];
  const msgTs = req.headers['svix-timestamp'];
  const msgSig = req.headers['svix-signature'];

  if (!msgId || !msgTs || !msgSig) {
    log.warn({ headers: Object.keys(req.headers) }, '[Webhook/PostForme] header Svix tidak lengkap');
    return { ok: false, reason: 'missing-svix-headers' };
  }

  try {
    const keyBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const toSign = `${msgId}.${msgTs}.${rawBody}`;
    const computed = crypto.createHmac('sha256', keyBytes).update(toSign, 'utf8').digest('base64');
    const expected = `v1,${computed}`;

    const valid = String(msgSig).split(' ').some((s) => {
      try { return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)); } catch { return false; }
    });
    return valid ? { ok: true } : { ok: false, reason: 'signature-mismatch' };
  } catch {
    return { ok: false, reason: 'verification-error' };
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

  app.post(
    '/webhook/postforme',
    express.raw({ type: '*/*' }),
    async (req, res) => {
      const rawBody =
        typeof req.body === 'string'
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body.toString('utf8')
            : '';

      const verdict = verifyPostformeSignature(req, rawBody);
      if (!verdict.ok) {
        log.warn(
          { reason: verdict.reason, ip: req.ip },
          `[Webhook/PostForme] signature gagal: ${verdict.reason}`,
        );
        // Tetap 200 agar PostForme tidak retry terus — tapi log peringatan
        return res.status(200).send('OK');
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || '{}');
      } catch {
        return res.status(400).send('Invalid JSON');
      }

      res.status(200).send('OK');

      const eventType = payload?.type ?? payload?.event_type ?? payload?.event ?? 'unknown';
      const postId = payload?.data?.id ?? payload?.data?.post_id ?? payload?.post_id;

      log.info(
        { eventType, postId, keys: Object.keys(payload?.data ?? {}) },
        `[Webhook/PostForme] event: ${eventType}`,
      );

      setImmediate(async () => {
        try {
          const bot = getBot();
          const notifyChatId = getNotifyChat('default');

          if (eventType === 'social.post.created' && postId) {
            log.info({ postId }, '[Webhook/PostForme] post dibuat di PostForme');
          }

          // Log event tidak dikenal agar bisa identifikasi event type baru dari PostForme
          if (eventType === 'unknown') {
            log.warn({ payload }, '[Webhook/PostForme] event type tidak dikenali');
            if (bot && notifyChatId) {
              await bot.telegram.sendMessage(
                notifyChatId,
                `⚡ PostForme webhook: event baru tidak dikenali\n${JSON.stringify(payload, null, 2).slice(0, 500)}`,
              ).catch(() => {});
            }
          }
        } catch (err) {
          log.error({ err: err?.message }, `[Webhook/PostForme] error: ${err?.message}`);
        }
      });
    },
  );

  return app;
}
