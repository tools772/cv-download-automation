import path from 'node:path';
import fs from 'fs-extra';
import type { Page } from 'playwright';
import { projectRoot } from '../config/env.js';
import { logger } from './logger.js';

const screenshotDir = path.join(projectRoot, 'sessions', 'screenshots');

export async function ensureScreenshotDir(): Promise<string> {
  await fs.ensureDir(screenshotDir);
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
