# TestSprite — SMM Telegram Bridge

## Project

- **Path:** `telegram-bridge/`
- **Type:** Node.js (ESM), no web UI — Telegram + Express webhook
- **Critical paths:** Outstand publish dedup, webhook dedup, daily duplicate tracking

## Run tests locally

```bash
cd telegram-bridge
npm test
```

## Focus areas for TestSprite MCP

1. **`groupAccountsByNetwork`** — duplicate `socialAccountIds` must not create duplicate entries per platform batch (`tests/groupAccountsByNetwork.test.js`).
2. **`webhookDedup`** — identical webhook body must not process twice (`tests/webhookDedup.test.js`).
3. **`accountDayUsage`** — `failed` + `platformPostId` must block re-publish same day; sheet duplicate annotation (`tests/accountDayUsage.test.js`).
4. **`publishBulk`** — `tests/publishBulk.integration.test.js` mocks `POST /v1/posts`: one HTTP call per platform, unique `accounts[]`, @tiaemng failed-but-live exclusion.
5. **`GET /health`** — returns `{ ok: true, service: 'smm-telegram-bridge' }`.

## Out of scope (manual / Outstand API audit)

- Live Instagram grid tile count
- End-to-end Telegram + Meta publish

## PRD snippet

When one operator taps Send Now, the bridge must send **one** Outstand `POST /v1/posts` per platform with **deduplicated** account IDs. Webhook retries with the same body must not double-write Sheets. Accounts with `failed` status but a `platformPostId` must be treated as already live for same-day exclusion.
