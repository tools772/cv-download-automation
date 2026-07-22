import path from 'node:path';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

const RESUME_FILE = /\.(pdf|doc|docx)$/i;

function isResumeFileName(fileName: string): boolean {
  const base = path.basename(fileName);
  if (!base || base.startsWith('.') || base.startsWith('__MACOSX')) {
    return false;
  }
  return RESUME_FILE.test(base);
}

export async function extractPageZip(
  zipPath: string,
  extractRootDir: string,
): Promise<string> {
  const resolvedZip = path.resolve(zipPath);
  if (!(await fs.pathExists(resolvedZip))) {
    throw new Error(`Zip file not found: ${resolvedZip}`);
  }

  const extractDir = path.join(
    extractRootDir,
    path.basename(resolvedZip, path.extname(resolvedZip)),
  );
  await fs.ensureDir(extractDir);

  const zip = new AdmZip(resolvedZip);
  zip.extractAllTo(extractDir, true);

  logger.info('Extracted page zip', { zipPath: resolvedZip, extractDir });
  return extractDir;
}

export async function listResumeFiles(dir: string): Promise<string[]> {
  const resolvedDir = path.resolve(dir);
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(resolvedDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listResumeFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && isResumeFileName(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}
