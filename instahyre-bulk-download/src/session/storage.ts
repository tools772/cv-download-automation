import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function getStorageStatePath(config: InstahyreConfig): string {
  return path.join(config.sessionDir, config.storageStateFile);
}

export async function sessionExists(config: InstahyreConfig): Promise<boolean> {
  return fs.pathExists(getStorageStatePath(config));
}

export async function ensureSessionDir(config: InstahyreConfig): Promise<void> {
  await fs.ensureDir(config.sessionDir);
}

export async function saveStorageState(
  context: BrowserContext,
  config: InstahyreConfig,
): Promise<void> {
  await ensureSessionDir(config);
  const statePath = getStorageStatePath(config);
  await context.storageState({ path: statePath });
  logger.info('Instahyre session saved', { statePath });
}
