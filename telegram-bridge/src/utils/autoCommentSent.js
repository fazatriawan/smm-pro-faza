import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/auto-comment-sent.json');

/** @type {Record<string, number> | null} */
let memory = null;

async function load() {
  if (memory) return memory;
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    memory =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
  } catch {
    memory = {};
  }
  return memory;
}

async function save() {
  if (!memory) return;
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

/**
 * @param {string} key — `${postId}:${accountId}`
 */
export async function wasAutoCommentSent(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  const data = await load();
  return Boolean(data[k]);
}

/**
 * @param {string} key
 */
export async function markAutoCommentSent(key) {
  const k = String(key || '').trim();
  if (!k) return;
  const data = await load();
  data[k] = Date.now();
  await save();
}
