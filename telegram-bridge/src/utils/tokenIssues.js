import fs from 'fs';
import path from 'path';
import { dataPath } from './dataPath.js';

// Kenapa file ini ada:
// PostForMe (dan Woopsocial) menampilkan status "connected" di dashboard mereka
// berdasarkan record OAuth yang tersimpan di DB mereka — BUKAN hasil cek live ke
// TikTok/Meta setiap saat. Refresh token bisa mati di sisi platform (TikTok dll)
// tanpa status "connected" itu ikut berubah. Satu-satunya momen kita benar-benar
// tahu token sudah mati adalah saat publish sungguhan gagal dengan pesan
// "invalid token/expired/oauth/..." (classifyRetryError → FIX_ACCOUNT).
//
// File ini menyimpan histori itu per accountId supaya:
// - reconnectMonitor.js bisa kirim alert harian meski dashboard publisher masih
//   bilang "connected" (lihat reconnectMonitor.js — sebelumnya cuma andalkan
//   field isActive yang tidak pernah diisi oleh postforme.js).
// - /cekakun bisa tampilkan pesan error asli, bukan cuma "Gagal publish hari ini".

const STORE_FILE = dataPath('token-issues.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(data) {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Catat akun yang publish-nya gagal karena token/permission (FIX_ACCOUNT).
 * Idempotent — dipanggil ulang tiap publish gagal, count bertambah, error terbaru dipakai.
 * @param {{ accountId: string, network?: string, username?: string, error?: string }} account
 */
export function recordTokenIssue({ accountId, network, username, error }) {
  if (!accountId) return;
  const store = readStore();
  const prev = store[accountId];
  store[accountId] = {
    accountId,
    network: network || prev?.network || '',
    username: username || prev?.username || '',
    error: error || prev?.error || '',
    firstSeenAt: prev?.firstSeenAt || Date.now(),
    lastSeenAt: Date.now(),
    count: (prev?.count || 0) + 1,
  };
  writeStore(store);
}

/**
 * Hapus flag — dipanggil saat akun berhasil publish lagi, artinya token sudah
 * OK (baik karena di-reconnect manual maupun ternyata cuma gangguan sementara).
 * @param {string} accountId
 */
export function clearTokenIssue(accountId) {
  if (!accountId) return;
  const store = readStore();
  if (store[accountId]) {
    delete store[accountId];
    writeStore(store);
  }
}

/**
 * @returns {Array<{ accountId: string, network: string, username: string, error: string, firstSeenAt: number, lastSeenAt: number, count: number }>}
 */
export function loadTokenIssues() {
  return Object.values(readStore());
}

/**
 * @returns {Map<string, ReturnType<typeof loadTokenIssues>[0]>}
 */
export function getTokenIssuesById() {
  const map = new Map();
  for (const issue of loadTokenIssues()) map.set(issue.accountId, issue);
  return map;
}
