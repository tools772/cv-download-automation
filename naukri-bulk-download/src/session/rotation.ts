import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getStorageStatePath, clearSession } from './storage.js';

/**
 * Optional session rotation: archive current session before refresh.
 */
export async function rotateSessionArchive(config: AppConfig): Promise<string | null> {
  const statePath = getStorageStatePath(config);
  if (!(await fs.pathExists(statePath))) return null;

  const archiveDir = path.join(config.sessionDir, 'archive');
  await fs.ensureDir(archiveDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(archiveDir, `storageState-${stamp}.json`);
  await fs.copy(statePath, archivePath);

  const metaPath = path.join(config.sessionDir, 'metadata.json');
  if (await fs.pathExists(metaPath)) {
    await fs.copy(metaPath, path.join(archiveDir, `metadata-${stamp}.json`));
  }

  await clearSession(config);
  logger.info('Session rotated — archived previous state', { archivePath });
  return archivePath;
}
