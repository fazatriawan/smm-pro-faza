import fs from 'fs';
import { dataPath } from './dataPath.js';

const LIB_FILE = dataPath('caption-library.json');

/**
 * @typedef {{ name: string, caption: string, savedAt: string }} SavedCaption
 * @returns {Record<string, SavedCaption>}
 */
export function loadCaptionLibrary() {
  try {
    const raw = fs.readFileSync(LIB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveCaptionLibrary(lib) {
  fs.writeFileSync(LIB_FILE, JSON.stringify(lib, null, 2), 'utf-8');
}

/**
 * @param {string} name
 * @param {string} caption
 */
export function saveCaption(name, caption) {
  const lib = loadCaptionLibrary();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  lib[key] = { name, caption, savedAt: new Date().toISOString() };
  saveCaptionLibrary(lib);
  return lib[key];
}

/** @param {string} name */
export function getCaption(name) {
  const lib = loadCaptionLibrary();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  return lib[key] || null;
}

/** @param {string} name */
export function deleteCaption(name) {
  const lib = loadCaptionLibrary();
  const key = name.toLowerCase().replace(/\s+/g, '-');
  const existed = Boolean(lib[key]);
  delete lib[key];
  if (existed) saveCaptionLibrary(lib);
  return existed;
}

export function listCaptions() {
  const lib = loadCaptionLibrary();
  return Object.values(lib).sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
  );
}
