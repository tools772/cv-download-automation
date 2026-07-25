import path from 'node:path';
import fs from 'fs-extra';
import { chromium, devices, type Browser, type BrowserContext } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { projectRoot } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { randomDelay } from '../utils/delay.js';
import {
  applyAntiDetection,
  getChromiumArgs,
  pickUserAgent,
  randomViewport,
} from './antiDetection.js';
import type { BrowserLaunchOptions } from '../types/index.js';

export interface LaunchedBrowser {
  browser: Browser | null;
  context: BrowserContext;
  userAgent: string;
  close: () => Promise<void>;
}

export function getNaukriChromeProfileDir(config: AppConfig): string {
  return path.join(config.sessionDir, 'naukri-chrome-profile');
}

async function applyContextHardening(
  context: BrowserContext,
  config: AppConfig,
): Promise<void> {
  await context.addInitScript(() => {
    const cores = [2, 4, 6, 8][Math.floor(Math.random() * 4)]!;
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });

    const memory = [2, 4, 8][Math.floor(Math.random() * 3)]!;
    Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });

    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 100) {
            imageData.data[i] = Math.min(255, (imageData.data[i] ?? 0) + Math.floor(Math.random() * 2));
          }
          ctx.putImageData(imageData, 0, 0);
        } catch {
          // cross-origin canvas
        }
      }
      return originalToDataURL.call(this, type, quality);
    };

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };

    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, parameter);
      };
    }

    Object.defineProperty(navigator, 'plugins', {
      get: () =>
        Object.assign(
          [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ],
          { length: 3 },
        ),
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en-GB', 'en'],
    });

    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50 + Math.floor(Math.random() * 50),
        downlink: 5 + Math.random() * 5,
        saveData: false,
      }),
    });
  });

  await applyAntiDetection(context);

  if (config.enableNetworkLogging) {
    context.on('request', (req) => {
      logger.debug('Network request', { method: req.method(), url: req.url() });
    });
    context.on('response', (res) => {
      logger.debug('Network response', { status: res.status(), url: res.url() });
    });
  }

  await randomDelay(200, 600);
}

async function launchPersistentChrome(
  config: AppConfig,
  launchArgs: string[],
  proxyServer: string | undefined,
  userAgent: string,
  viewport: { width: number; height: number },
  mobileEmulation: boolean,
): Promise<LaunchedBrowser> {
  const profileDir = getNaukriChromeProfileDir(config);
  await fs.ensureDir(profileDir);

  logger.info('Launching persistent Chrome profile for Naukri', { profileDir });

  const screenWidth = viewport.width + Math.floor(Math.random() * 4) * 10;
  const screenHeight = viewport.height + Math.floor(Math.random() * 4) * 10;

  const downloadsPath = config.localSaveDir || path.join(config.sessionDir, 'downloads');
  await fs.ensureDir(downloadsPath);

  const contextOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: false,
    channel: 'chrome',
    args: launchArgs,
    proxy: proxyServer ? { server: proxyServer } : undefined,
    userAgent: mobileEmulation ? devices['iPhone 13'].userAgent : userAgent,
    viewport: mobileEmulation ? devices['iPhone 13'].viewport : viewport,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    // Force Chrome to land CVs here — otherwise persistent Chrome dumps into ~/Downloads
    // while Playwright misses the event and retries Download CV (4× duplicates).
    downloadsPath,
    isMobile: mobileEmulation,
    hasTouch: mobileEmulation,
    colorScheme: 'light',
    screen: { width: screenWidth, height: screenHeight },
  };

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, contextOptions);
    logger.info('Using installed Google Chrome (persistent profile)');
  } catch (err) {
    logger.warn('Chrome channel unavailable, using bundled Chromium', {
      error: err instanceof Error ? err.message : String(err),
    });
    context = await chromium.launchPersistentContext(profileDir, {
      ...contextOptions,
      channel: undefined,
    });
  }

  await applyContextHardening(context, config);

  const close = async (): Promise<void> => {
    await context.close();
  };

  return { browser: null, context, userAgent, close };
}

export async function launchBrowser(
  config: AppConfig,
  options: BrowserLaunchOptions & {
    storageStatePath?: string;
  } = {},
): Promise<LaunchedBrowser> {
  const headless = config.manualDownloadSave
    ? false
    : (options.headless ?? config.headless);
  const mobileEmulation = options.mobileEmulation ?? config.mobileEmulation;
  const proxyServer = options.proxyServer ?? config.proxyServer;
  const userAgent = pickUserAgent();
  const viewport = randomViewport();

  logger.info('Launching Chromium', {
    headless,
    mobileEmulation,
    proxy: !!proxyServer,
    manualDownloadSave: config.manualDownloadSave,
    manualResdexLogin: config.manualResdexLogin,
    acceptDownloads: true,
    localSaveDir: config.localSaveDir,
  });

  const harPath =
    options.harPath ??
    (config.enableHarExport || options.recordHar
      ? path.join(projectRoot, 'sessions', `trace-${Date.now()}.har`)
      : undefined);

  const launchArgs = [...getChromiumArgs(), '--disable-features=DownloadBubble,DownloadBubbleV2'];

  if (config.manualResdexLogin) {
    return launchPersistentChrome(config, launchArgs, proxyServer, userAgent, viewport, mobileEmulation);
  }

  const launchOpts = {
    headless,
    args: launchArgs,
    proxy: proxyServer ? { server: proxyServer } : undefined,
  };

  let browser: Browser;
  if (config.manualDownloadSave) {
    try {
      browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
      logger.info('Using installed Google Chrome');
    } catch (err) {
      logger.warn('Chrome channel unavailable, using bundled Chromium', {
        error: err instanceof Error ? err.message : String(err),
      });
      browser = await chromium.launch(launchOpts);
    }
  } else {
    browser = await chromium.launch(launchOpts);
  }

  const screenWidth = viewport.width + Math.floor(Math.random() * 4) * 10;
  const screenHeight = viewport.height + Math.floor(Math.random() * 4) * 10;

  const downloadsPath = config.localSaveDir || path.join(config.sessionDir, 'downloads');
  await fs.ensureDir(downloadsPath);

  const contextOptions = {
    userAgent,
    viewport: mobileEmulation ? devices['iPhone 13'].viewport : viewport,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    ignoreHTTPSErrors: true,
    acceptDownloads: true as const,
    downloadsPath,
    storageState: options.storageStatePath,
    recordHar: harPath ? { path: harPath, content: 'embed' as const } : undefined,
    isMobile: mobileEmulation,
    hasTouch: mobileEmulation,
    colorScheme: 'light' as const,
    screen: { width: screenWidth, height: screenHeight },
  };

  if (mobileEmulation) {
    Object.assign(contextOptions, devices['iPhone 13']);
    contextOptions.userAgent = devices['iPhone 13'].userAgent;
  }

  const context = await browser.newContext(contextOptions);
  await applyContextHardening(context, config);

  const close = async (): Promise<void> => {
    try {
      await context.close();
    } finally {
      await browser.close();
      if (harPath) {
        logger.info('HAR export saved', { harPath });
      }
    }
  };

  return { browser, context, userAgent, close };
}

export async function createPage(
  context: BrowserContext,
): Promise<import('playwright').Page> {
  const existing = context.pages().find((p) => /naukri\.com/i.test(p.url()));
  const page = existing ?? context.pages()[0] ?? (await context.newPage());
  // One automation tab only — never leave blank/extra tabs open during a fetch.
  for (const extra of context.pages()) {
    if (extra !== page) {
      await extra.close().catch(() => undefined);
    }
  }
  await applyAntiDetection(context, page);
  await randomDelay(150, 400);
  return page;
}

/** Close every tab except `keep` so profile hops stay in the same window/tab. */
export async function closeExtraPages(
  context: BrowserContext,
  keep: import('playwright').Page,
): Promise<void> {
  for (const extra of context.pages()) {
    if (extra !== keep) {
      await extra.close().catch(() => undefined);
    }
  }
}
