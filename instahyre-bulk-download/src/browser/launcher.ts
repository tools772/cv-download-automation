import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import type { BrowserLaunchOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface LaunchedBrowser {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

const STABLE_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--disable-popup-blocking',
  // Required on most Linux VMs/Docker; avoids Chromium failing or OOM-killing early.
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
] as const;

export async function launchBrowser(
  config: InstahyreConfig,
  options: BrowserLaunchOptions = {},
): Promise<LaunchedBrowser> {
  const headless = options.headless ?? config.headless;

  logger.info('Launching browser for Instahyre', { headless });

  const launchOpts = {
    headless,
    args: [...STABLE_LAUNCH_ARGS],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  let browser: import('playwright').Browser;
  // Always use bundled Chromium — attaching to system Chrome (channel: 'chrome') opens a
  // second window beside the user's normal Chrome and is easy to close by mistake.
  browser = await chromium.launch(launchOpts);

  browser.on('disconnected', () => {
    logger.error('Browser process disconnected unexpectedly');
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: options.storageStatePath,
  });

  context.on('close', () => {
    logger.warn('Browser context closed');
  });

  const close = async (): Promise<void> => {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  };

  return { browser, context, close };
}

export async function createPage(
  context: BrowserContext,
): Promise<import('playwright').Page> {
  const page = await context.newPage();
  page.on('close', () => {
    logger.warn('Browser tab closed unexpectedly');
  });
  page.on('crash', () => {
    logger.error('Browser tab crashed');
  });
  return page;
}
