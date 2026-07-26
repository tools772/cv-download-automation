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
  // Prefer bundled Chromium when present (CI/local). Packaged Windows/mac installers
  // skip browser download, so fall back to system Google Chrome (same as Login Instahyre).
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/executable doesn.?t exist|browserType\.launch/i.test(msg)) {
      throw err;
    }
    logger.warn('Bundled Chromium missing — launching system Google Chrome', { error: msg });
    console.log(
      'Bundled Chromium not found — using installed Google Chrome. Install Chrome if this fails.',
    );
    try {
      browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
    } catch (chromeErr) {
      const chromeMsg = chromeErr instanceof Error ? chromeErr.message : String(chromeErr);
      throw new Error(
        `Could not launch a browser for Instahyre.\n` +
          `Bundled Chromium is missing and Google Chrome was not found.\n` +
          `Install Google Chrome, then retry.\n` +
          `(${chromeMsg})`,
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
