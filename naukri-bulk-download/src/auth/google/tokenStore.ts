import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig, GoogleTokenSet } from '../../types/index.js';
import { readEncryptedJson, writeEncryptedJson } from '../../storage/secureStore.js';
import { logger } from '../../utils/logger.js';

export async function saveGoogleTokens(
  config: AppConfig,
  tokens: GoogleTokenSet,
): Promise<void> {
  await fs.ensureDir(path.dirname(config.googleTokenFile));
  await writeEncryptedJson(
    config.googleTokenFile,
    tokens,
    config.tokenEncryptionKey,
  );
  logger.info('Google tokens persisted', {
    path: config.googleTokenFile,
    encrypted: Boolean(config.tokenEncryptionKey),
  });
}

export async function loadGoogleTokens(
  config: AppConfig,
): Promise<GoogleTokenSet | null> {
  return readEncryptedJson<GoogleTokenSet>(
    config.googleTokenFile,
    config.tokenEncryptionKey,
  );
}

export async function googleTokensExist(config: AppConfig): Promise<boolean> {
  return fs.pathExists(config.googleTokenFile);
}
