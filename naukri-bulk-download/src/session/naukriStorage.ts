import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext } from 'playwright';
import type { AppConfig, SessionMetadata } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function getNaukriStoragePath(config: AppConfig): string {
  return path.join(config.sessionDir, config.naukriStorageStateFile);
}

export function getNaukriMetadataPath(config: AppConfig): string {
  return path.join(config.sessionDir, 'naukri-metadata.json');
}

export async function naukriSessionExists(config: AppConfig): Promise<boolean> {
  return fs.pathExists(getNaukriStoragePath(config));
}

export async function saveNaukriStorageState(
  context: BrowserContext,
  config: AppConfig,
  metadata: Omit<SessionMetadata, 'savedAt'>,
): Promise<string> {
  await fs.ensureDir(config.sessionDir);
  const statePath = getNaukriStoragePath(config);
  await context.storageState({ path: statePath });
  await fs.writeJson(
    getNaukriMetadataPath(config),
    { ...metadata, savedAt: new Date().toISOString() },
    { spaces: 2 },
  );
  logger.info('Naukri session saved', {
    statePath,
    cookies: (await context.cookies()).length,
  });
  return statePath;
}

export async function clearNaukriSession(config: AppConfig): Promise<void> {
  await Promise.all([
    fs.remove(getNaukriStoragePath(config)).catch(() => undefined),
    fs.remove(getNaukriMetadataPath(config)).catch(() => undefined),
  ]);
}
