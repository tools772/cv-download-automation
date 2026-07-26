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
  console.log('Opening Instahyre in Chromium — do not close this window until the download completes.');

  const launchOpts = {
    headless,
    args: [...STABLE_LAUNCH_ARGS],
    ignoreDefaultArgs: ['--enable-automation'] as string[],
  };

  let browser: import('playwright').Browser;
  // Match Login Instahyre: system Chrome first. Packaged installers skip the
  // Playwright browser download, so bundled Chromium is only a dev fallback.
  try {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Google Chrome unavailable — trying bundled Chromium', { error: msg });
    try {
      browser = await chromium.launch(launchOpts);
    } catch (chromiumErr) {
      const chromiumMsg =
        chromiumErr instanceof Error ? chromiumErr.message : String(chromiumErr);
      throw new Error(
        `Could not launch a browser for Instahyre.\n` +
          `Google Chrome was not found and this build has no bundled Chromium.\n` +
          `Install Google Chrome (https://www.google.com/chrome/), then retry.\n` +
          `(${chromiumMsg})`,
      );
    }
  }

  browser.on('disconnected', () => {
    logger.error('Browser process disconnected unexpectedly');
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: options.storageStatePath,
  });

  // tsx/esbuild `keepNames` injects `__name(...)` wrappers into evaluate callbacks.
  // Define the helper on every page so serialized callbacks don't throw ReferenceError.
  await context.addInitScript(
    'window.__name = window.__name || function (f) { return f; };',
  );

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
    console.warn(
      'INSTAHYRE WARNING: Automation browser tab was closed. Download will fail if still in progress.',
    );
  });
  page.on('crash', () => {
    logger.error('Browser tab crashed');
  });
  return page;
}
