import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { env } from '../config/env.js';

let resolvedPath = null;

/**
 * @param {string} dir
 * @param {number} depth
 */
function findFfmpegExeInTree(dir, depth = 0) {
  if (depth > 6 || !dir || !fs.existsSync(dir)) return null;

  for (const name of ['ffmpeg.exe', 'ffmpeg']) {
    const direct = path.join(dir, name);
    if (fs.existsSync(direct)) return direct;
  }

  const binDir = path.join(dir, 'bin');
  for (const name of ['ffmpeg.exe', 'ffmpeg']) {
    const inBin = path.join(binDir, name);
    if (fs.existsSync(inBin)) return inBin;
  }

  if (depth >= 6) return null;

  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const found = findFfmpegExeInTree(full, depth + 1);
      if (found) return found;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function findWinGetFfmpeg() {
  const base = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Packages'
  );
  if (!fs.existsSync(base)) return null;

  for (const pkg of fs.readdirSync(base)) {
    if (!/ffmpeg/i.test(pkg)) continue;
    const exe = findFfmpegExeInTree(path.join(base, pkg));
    if (exe) return exe;
  }
  return null;
}

function findOnPath() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const arg = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const r = spawnSync(cmd, [arg], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout?.trim()) {
      const line = r.stdout.trim().split(/\r?\n/)[0].trim();
      if (line && fs.existsSync(line)) return line;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Path ke executable ffmpeg (bukan hanya "ffmpeg" di PATH).
 */
export function getFfmpegExecutable() {
  if (resolvedPath) return resolvedPath;

  if (env.ffmpegPath && fs.existsSync(env.ffmpegPath)) {
    resolvedPath = env.ffmpegPath;
    return resolvedPath;
  }

  const onPath = findOnPath();
  if (onPath) {
    resolvedPath = onPath;
    return resolvedPath;
  }

  if (process.platform === 'win32') {
    const winget = findWinGetFfmpeg();
    if (winget) {
      resolvedPath = winget;
      return resolvedPath;
    }
  }

  resolvedPath = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return resolvedPath;
}

/** @returns {{ ok: boolean, path: string }} */
export function probeFfmpeg() {
  const exe = getFfmpegExecutable();
  try {
    const r = spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    return { ok: r.status === 0, path: exe };
  } catch {
    return { ok: false, path: exe };
  }
}

export function resetFfmpegCache() {
  resolvedPath = null;
}
