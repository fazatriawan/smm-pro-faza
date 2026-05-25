# Migration Plan — Telegram Bridge

> **Status:** Phase 0 (Foundation) — in progress.
> **Tujuan:** memindahkan bot dari arsitektur in-memory single-process ke
> sistem queued + persisted yang aman untuk 144+ akun dan tahan crash.
>
> **Prinsip kerja:** *zero-downtime*, *zero-risk* untuk operasi pagi user.
> Tidak ada deploy yang menyentuh perilaku publish sebelum diuji di staging.

---

## 0. Snapshot arsitektur sekarang (sebelum migrasi)

| Aspek                | Sekarang                                           | Target                              |
| -------------------- | -------------------------------------------------- | ----------------------------------- |
| Process model        | 1 Node.js (PM2 cluster, 1 instance)                | Producer + Worker fleet             |
| State                | In-memory (`session`, cache, `runtimeStore`)       | PostgreSQL + Redis                  |
| Job execution        | Sinkron dalam request bot                          | BullMQ queue, async worker          |
| Idempotency          | Lewat dedupe Outstand + cache hari                 | SHA256 idempotencyKey persisted     |
| Reporting            | Google Sheets (rewrite per batch)                  | Postgres event-log → Sheets sync    |
| Logging              | `console.log/error`                                | Pino structured (JSON) → file/Loki  |
| Vendor coupling      | `services/outstand.js` dipanggil langsung          | `IPublishingAdapter` abstraction    |
| Auto-refresh status  | Polling Outstand tiap N menit + webhook            | Webhook-first + lazy poll fallback  |

---

## 1. Roadmap berfase

### Phase 0 — Foundation (sedang dikerjakan, **TIDAK** deploy malam ini)

Tujuan: meletakkan tulang punggung tanpa mengubah perilaku produksi.

- [x] Feature branch `feat/phase0-foundation`
- [x] `src/utils/logger.js` — Pino wrapper drop-in (fallback `console.*` aman)
- [x] `src/utils/idempotency.js` — SHA256 publish key builder (order-invariant)
- [x] `src/utils/errorTypes.js` — taksonomi error terstruktur (`PublishErrorCode`, kelas error)
- [x] `src/adapters/IPublishingAdapter.js` — kontrak abstrak + typedef DTO
- [x] `src/adapters/OutstandAdapter.js` — skeleton wrapper
- [x] `package.json` — tambah `pino` & `pino-pretty` (belum `npm install`)
- [x] `docs/MIGRATION.md` — file ini
- [x] **Migrasi modul ke `createLogger`** (smoke-tested):
      - `src/index.js` → `createLogger('app')`
      - `src/services/outstand.js` → `createLogger('outstand')`
      - `src/services/dailySummary.js` → `createLogger('daily-summary')`
      - `src/services/ai.js` → `createLogger('ai')`
      - `src/services/imageToVideo.js` → `createLogger('ffmpeg')`
- [ ] (Esok malam) Migrasi 3 modul besar sisanya: `bot.js` (18 calls),
      `sheets.js` (13 calls), `todayPublish.js` (3 calls)
- [ ] (Esok malam) `npm install` + restart PM2 + verifikasi log

#### Phase 1 prep (sudah ada di branch, BELUM aktif runtime)

- [x] `src/queue/types.js` — typedef BullMQ job (PublishJobData, StatusPollJobData,
      WebhookJobData, default opts dengan backoff exponential)
- [x] `prisma/schema.prisma` — draft skema 5 tabel: `accounts`, `publish_jobs`,
      `post_targets`, `job_events`, `webhook_events`. Belum di-`prisma generate`,
      belum ada DB.

**Acceptance criteria Phase 0:**

1. Bot tetap online setelah deploy (cek `pm2 status` + `/ping`).
2. Log Pino muncul di `pm2 logs smm-telegram-bridge` dalam format JSON
   (atau pretty kalau `LOG_PRETTY=1`).
3. Publish flow harian tidak terganggu — minimal 1 batch `/random` sukses.
4. Tidak ada error baru di `pm2 logs smm-telegram-bridge --err`.

### Phase 1 — Queue & Persistence (target: minggu depan)

- [ ] Stack: Postgres + Redis di VPS (docker-compose terpisah).
- [ ] Prisma schema awal: `accounts`, `publish_jobs`, `post_targets`, `events`.
- [ ] `src/queue/publish.queue.js` — producer dengan idempotencyKey SHA256.
- [ ] `src/worker/publish.worker.js` — consumer dengan retry/backoff dari BullMQ.
- [ ] Migrasi 1 alur: `/random` → enqueue → worker → adapter.publish().
- [ ] Webhook Outstand → update job state di Postgres → emit ke bot.
- [ ] Sheets writer baca dari Postgres (event log), bukan dari memory.

### Phase 2 — Smart features (setelah Phase 1 stabil)

- [ ] Account health score (success_rate, last_fail_at, cooldown_until).
- [ ] Circuit breaker per (account × platform).
- [ ] Anti-shadowban scheduler: jitter, max per jam, off-hours guard.
- [ ] `/dryrun` (preview tanpa publish), `/rencana` (kuota harian).
- [ ] Worker concurrency configurable per platform.

### Phase 3 — Observability

- [ ] Health endpoint `/healthz` (DB + Redis + Outstand probe).
- [ ] Metrik Prometheus (publish_total, publish_failed_total, queue_depth).
- [ ] Alert ke Telegram saat queue depth > N atau circuit breaker terbuka.

---

## 2. Rencana commit Phase 0 (malam ini)

Branch: `feat/phase0-foundation`

```
commit 1: chore(logging): add Pino logger wrapper with safe console fallback
commit 2: feat(adapter): add IPublishingAdapter interface + OutstandAdapter skeleton
commit 3: docs(migration): add Phase 0-3 migration roadmap and rollback plan
commit 4: feat(utils): add idempotency key builder + structured error taxonomy
commit 5: refactor(index): migrate src/index.js console.* to createLogger('app')
commit 6: refactor(services): migrate outstand/daily-summary/ai/ffmpeg to createLogger
commit 7: feat(queue): add BullMQ job DTO typedefs (Phase 1 prep, zero runtime)
commit 8: feat(prisma): draft Postgres schema for jobs/accounts/events (Phase 1)
```

> **Tidak** akan di-merge ke `main` dan **tidak** di-deploy ke VPS malam ini.
> Branch ini hanya menyimpan groundwork untuk dideploy besok malam setelah
> user selesai memakai bot pagi/siang.

### Smoke test lokal (sudah dilakukan)

- `node --check` lolos untuk semua file Phase 0.
- `logger.js` runtime: log keluar via fallback `console.*` saat pino belum
  ter-install — siap dipakai di VPS sebelum `npm install`.
- `idempotency.js` runtime: order-invariant terhadap urutan targets, key
  berubah saat targets/media berbeda.

---

## 3. Runbook deploy Phase 0 (besok malam, **setelah** user selesai pakai bot)

```bash
# di workstation
git checkout feat/phase0-foundation
git push origin feat/phase0-foundation

# di VPS
ssh root@<vps>
cd /opt/telegram-bridge
git fetch origin
git checkout feat/phase0-foundation
npm install --omit=dev   # produksi: tanpa pino-pretty
pm2 restart smm-telegram-bridge --update-env

# smoke test (5 menit pertama)
pm2 logs smm-telegram-bridge --lines 50
# Kirim /ping ke bot → harus balas.
# Kirim /kuota → harus jalan.
```

**Kriteria sukses:** `pm2 logs` tidak ada `ERR_MODULE_NOT_FOUND`, `/ping`
balas dalam 2 detik, satu batch `/random` selesai tanpa error baru.

---

## 4. Rollback plan

Kalau ada hal aneh setelah deploy Phase 0:

```bash
# di VPS
cd /opt/telegram-bridge
git checkout main           # atau commit terakhir yang diketahui stabil
pm2 restart smm-telegram-bridge --update-env
pm2 logs smm-telegram-bridge --lines 30
```

Karena Phase 0 **tidak** mengubah `services/`, `routes/`, atau perilaku
publish, rollback hanya butuh `git checkout main` + restart. Tidak ada
state di Postgres/Redis yang perlu di-rollback (belum dipasang).

---

## 5. Risiko & mitigasi

| Risiko                                       | Mitigasi                                                   |
| -------------------------------------------- | ---------------------------------------------------------- |
| `pino` gagal install di VPS                  | Logger fallback `console.*` otomatis; bot tetap jalan.     |
| `pino-pretty` missing di produksi            | `transport` di-skip otomatis (`try/catch` di logger).      |
| Log volume membengkak                        | `LOG_LEVEL=info`; debug hanya untuk path baru.             |
| Call-site `console.log` lupa diganti         | Tidak masalah — fungsionalitas tidak terdampak.            |
| Skeleton adapter accidentally diimport       | Tidak diimport di entry point; safe.                       |

---

## 6. Kebijakan logging (mulai Phase 0)

- **DO** `log.info({ jobId, network }, 'publish enqueued')` — struktur + msg pendek.
- **DO** `log.error({ err }, 'publish failed')` — sertakan error object (Pino
  serialize stack & code otomatis).
- **DON'T** `log.info('publish enqueued: ' + JSON.stringify(payload))` — hilangkan
  string templating; biarkan Pino yang serialisasi.
- **DON'T** log full media buffer atau token mentah. Mask token dengan `[REDACTED]`.
- Naming binding: `component:<service>` (mis. `adapter:outstand`, `sheets`,
  `bot:command:retry`).

---

## 7. Daftar pemetaan service → adapter (untuk Phase 1)

| Service eksisting                  | Adapter target              | Catatan                              |
| ---------------------------------- | --------------------------- | ------------------------------------ |
| `services/outstand.publishBulk`    | `OutstandAdapter.publish`   | Wajib idempotencyKey                 |
| `services/outstand.getPost`        | `OutstandAdapter.getStatus` | Sudah ada skeleton                   |
| `services/outstand.listSocialAccounts` | `OutstandAdapter.listAccounts` | Sudah ada skeleton           |
| (future) Vista Social YouTube      | `VistaYoutubeAdapter`       | Phase 2                              |
| (future) Meta Graph direct         | `MetaDirectAdapter`         | Phase 2 / 3                          |

---

_Last updated: Phase 0 setup, 2026-05-25 (malam, prep only, no deploy)._
