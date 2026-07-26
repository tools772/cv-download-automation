import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { projectRoot } from '../config/env.js';
import { logger } from './logger.js';
import { resolveWritableDir } from './writableDir.js';

let screenshotDir: string | null = null;

export async function ensureScreenshotDir(): Promise<string> {
  screenshotDir ??= resolveWritableDir(
    path.join(projectRoot, 'sessions', 'screenshots'),
    path.join(os.homedir(), 'PerfectVentures', 'screenshots'),
  );
  return screenshotDir;
}

export async function saveScreenshot(
  page: Page,
  label: string,
): Promise<string> {
  const dir = await ensureScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80);
  const filePath = path.join(dir, `${timestamp}_${safeLabel}.png`);

  await page.screenshot({ path: filePath, fullPage: true });
  logger.info('Screenshot saved', { filePath, label });
  return filePath;
}
