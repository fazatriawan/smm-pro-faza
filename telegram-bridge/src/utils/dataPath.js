import { join } from 'path';
import { env } from '../config/env.js';

export function dataPath(file) {
  return join(env.dataDir, file);
}
