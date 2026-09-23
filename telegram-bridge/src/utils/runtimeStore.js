import fs from 'fs';
import path from 'path';
import { dataPath } from './dataPath.js';

const storePath = dataPath('runtime.json');

function readStore() {
  try {
    if (!fs.existsSync(storePath)) return {};
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

export function getRuntime(key) {
  return readStore()[key];
}

export function setRuntime(key, value) {
  const data = readStore();
  data[key] = value;
  writeStore(data);
}

export function getRuntimeStorePath() {
  return storePath;
}
