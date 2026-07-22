import path from 'node:path';
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
    acceptDownloads: true,
    localSaveDir: config.localSaveDir,
  });

  const harPath =
    options.harPath ??
    (config.enableHarExport || options.recordHar
      ? path.join(
          projectRoot,
          'sessions',
          `trace-${Date.now()}.har`,
        )
      : undefined);

  const launchArgs = [...getChromiumArgs()];

  // Always disable download bubble — prevents UI interruptions in all modes
  launchArgs.push('--disable-features=DownloadBubble,DownloadBubbleV2');

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

  // Vary screen resolution slightly to avoid a consistent fingerprint
  const screenWidth = viewport.width + Math.floor(Math.random() * 4) * 10;
  const screenHeight = viewport.height + Math.floor(Math.random() * 4) * 10;

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    // Use pickUserAgent() consistently — the only user agent source
    userAgent: userAgent,
    viewport: mobileEmulation ? devices['iPhone 13'].viewport : viewport,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    storageState: options.storageStatePath,
    recordHar: harPath ? { path: harPath, content: 'embed' } : undefined,
    isMobile: mobileEmulation,
    hasTouch: mobileEmulation,
    colorScheme: 'light',
    // Vary screen resolution per session
    screen: {
      width: screenWidth,
      height: screenHeight,
    },
  };

  if (mobileEmulation) {
    Object.assign(contextOptions, devices['iPhone 13']);
    contextOptions.userAgent = devices['iPhone 13'].userAgent;
  }

  const context = await browser.newContext(contextOptions);

  // ── Hardware + Canvas + WebGL fingerprint spoofing ───────────────────────
  // Injected before any page script runs — makes the browser look like a
  // real user machine rather than a headless automation context.
  await context.addInitScript(() => {
    // ── CPU cores — headless often reports 0 or a fixed value ─────────────
    const cores = [2, 4, 6, 8][Math.floor(Math.random() * 4)]!;
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => cores,
    });

    // ── Device memory — real machines report 2, 4, or 8 GB ───────────────
    const memory = [2, 4, 8][Math.floor(Math.random() * 3)]!;
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => memory,
    });

    // ── Screen color/pixel depth ──────────────────────────────────────────
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

    // ── Canvas fingerprint noise ──────────────────────────────────────────
    // Adds imperceptible per-session noise so every run has a unique canvas hash
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (
      type?: string,
      quality?: number,
    ) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 100) {
            imageData.data[i] = Math.min(
              255,
              (imageData.data[i] ?? 0) + Math.floor(Math.random() * 2),
            );
          }
          ctx.putImageData(imageData, 0, 0);
        } catch {
          // Cross-origin canvas — skip silently
        }
      }
      return originalToDataURL.call(this, type, quality);
    };

    // ── WebGL vendor/renderer spoof ───────────────────────────────────────
    // Headless Chrome reports SwiftShader — real machines report Intel/NVIDIA
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (
      parameter: number,
    ) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) return 'Intel Inc.';
      // UNMASKED_RENDERER_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };

    // Also patch WebGL2 if available
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (
        parameter: number,
      ) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, parameter);
      };
    }

    // ── Browser plugins — empty list is a headless signal ─────────────────
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

    // ── Language list — single language is a bot signal ───────────────────
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en-GB', 'en'],
    });

    // ── Notification permission — bots often have 'denied' ───────────────
    // Leave as-is; Playwright's stealth handles this

    // ── Connection type — adds realistic network info ─────────────────────
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50 + Math.floor(Math.random() * 50),
        downlink: 5 + Math.random() * 5,
        saveData: false,
      }),
    });
  });

  // Apply existing anti-detection (stealth scripts, webdriver flag, etc.)
  await applyAntiDetection(context);

  if (config.enableNetworkLogging) {
    context.on('request', (req) => {
      logger.debug('Network request', {
        method: req.method(),
        url: req.url(),
      });
    });
    context.on('response', (res) => {
      logger.debug('Network response', {
        status: res.status(),
        url: res.url(),
      });
    });
  }

  await randomDelay(200, 600);

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
  const page = await context.newPage();
  await applyAntiDetection(context, page);
  await randomDelay(150, 400);
  return page;
}