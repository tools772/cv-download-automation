import type { BrowserContext, Page, Request } from 'playwright';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';
import {
  NAUKRI_RESUME_DOWNLOAD_PATH,
  RESUME_DOWNLOAD_REQUEST_TIMEOUT_MS,
} from './constants.js';

export interface InterceptedResumeRequest {
  /** Full URL including dynamic resId, uname, searchParamStr, sid, etc. */
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  capturedAt: string;
}

const DOWNLOAD_TRIGGER_SELECTORS = [
  'button:has-text("Download CV")',
  'a:has-text("Download CV")',
  'button:has-text("Download Resume")',
  'button:has-text("View CV")',
  'a:has-text("View CV")',
  'text=Download CV',
  'text=View CV',
];

function isResumeDownloadRequest(req: Request): boolean {
  return req.url().includes(NAUKRI_RESUME_DOWNLOAD_PATH);
}

function serializeRequest(req: Request): InterceptedResumeRequest {
  return {
    url: req.url(),
    method: req.method(),
    headers: req.headers(),
    postData: req.postData() ?? undefined,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Opens the Resdex preview page and captures the real `/jsprofile/download/resume`
 * request emitted by the frontend. Query params (resId, uname, sid, etc.) must
 * NOT be constructed manually — they are bound to the live session/search context.
 */
export async function interceptResumeDownloadRequest(
  page: Page,
  context: BrowserContext,
  previewUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<InterceptedResumeRequest> {
  const timeoutMs = options.timeoutMs ?? RESUME_DOWNLOAD_REQUEST_TIMEOUT_MS;
  const captured: InterceptedResumeRequest[] = [];

  const onRequest = (req: Request): void => {
    if (!isResumeDownloadRequest(req)) return;
    captured.push(serializeRequest(req));
    logger.info('Intercepted resume download request (listener)', {
      method: req.method(),
      urlPreview: req.url().slice(0, 160),
    });
  };

  page.on('request', onRequest);
  context.on('request', onRequest);

  try {
    logger.info('Opening preview page', { previewUrl: previewUrl.slice(0, 120) });

    await page.goto(previewUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined);
    await delay(2500);

    if (captured.length > 0) {
      return captured[captured.length - 1]!;
    }

    for (const selector of DOWNLOAD_TRIGGER_SELECTORS) {
      const control = page.locator(selector).first();
      if ((await control.count()) === 0) continue;
      if (!(await control.isVisible().catch(() => false))) continue;

      try {
        logger.info('Triggering download control', { selector });
        await control.scrollIntoViewIfNeeded().catch(() => undefined);

        const req = await Promise.all([
          page.waitForRequest((r) => isResumeDownloadRequest(r), {
            timeout: Math.min(timeoutMs, 30_000),
          }),
          control.click({ timeout: 12_000 }),
        ]).then(([r]) => r);

        return serializeRequest(req);
      } catch {
        // try next control
      }
    }

    await delay(3000);
    if (captured.length > 0) {
      return captured[captured.length - 1]!;
    }

    throw new Error(
      `No ${NAUKRI_RESUME_DOWNLOAD_PATH} request intercepted. ` +
        'Ensure preview page loads and Download/View CV is available (HEADLESS=false).',
    );
  } finally {
    page.off('request', onRequest);
    context.off('request', onRequest);
  }
}
