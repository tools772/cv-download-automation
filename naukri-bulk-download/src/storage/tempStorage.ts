import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';
import { sanitizeFileName } from '../utils/sanitize.js';

export async function ensureTempDir(config: AppConfig): Promise<string> {
  await fs.ensureDir(config.tempDownloadDir);
  return config.tempDownloadDir;
}

export function buildTempFilePath(
  config: AppConfig,
  candidateId: string,
  extension: string,
  candidateName?: string,
): string {
  const label = sanitizeFileName(candidateName || candidateId);
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return path.join(config.tempDownloadDir, `${label}-${Date.now()}${ext}`);
}

export async function removeTempFile(filePath: string): Promise<void> {
  await fs.remove(filePath).catch(() => undefined);
}
