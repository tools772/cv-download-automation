import type { BrowserContext, Page } from 'playwright';
import type { AppConfig, SessionValidationResult } from '../types/index.js';
import { NAUKRI_URLS, LOGIN_FAILURE_URL_PATTERNS } from '../config/naukri-selectors.js';
import { createPage } from '../browser/launcher.js';
import { logger } from '../utils/logger.js';
import { randomDelay } from '../utils/delay.js';

export async function validateNaukriSession(
  context: BrowserContext,
  config: AppConfig,
): Promise<SessionValidationResult> {
  let page: Page | null = null;
  try {
    page = await createPage(context);
    await page.goto(NAUKRI_URLS.sessionValidate, {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });
    await randomDelay(1200, 2500);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    const url = page.url();
    if (
      LOGIN_FAILURE_URL_PATTERNS.some((p) => p.test(url)) ||
      /\/recruit\/login/i.test(url) ||
      /msg=ID/i.test(url)
    ) {
      return { valid: false, reason: 'Redirected to login', redirectedToLogin: true };
    }

    const body = await page.locator('body').innerText().catch(() => '');
    if (/session expired|please log in|enter registered email/i.test(body)) {
      return { valid: false, reason: 'Session expired or login form shown' };
    }

    if (!/recruit\.naukri\.com|resdex\.naukri\.com/i.test(url)) {
      return { valid: false, reason: `Unexpected URL after validation: ${url}` };
    }

    logger.info('Naukri session valid', { url });
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await page?.close().catch(() => undefined);
  }
}
