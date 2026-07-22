import type { BrowserContext, Page } from 'playwright';
import type { AppConfig, SessionValidationResult } from '../types/index.js';
import { URLS, LOGIN_FAILURE_URL_PATTERNS } from '../config/selectors.js';
import { createPage } from '../browser/launcher.js';
import { logger } from '../utils/logger.js';
import { saveScreenshot } from '../utils/screenshot.js';
import { randomDelay } from '../utils/delay.js';

export async function validateSession(
  context: BrowserContext,
  config: AppConfig,
): Promise<SessionValidationResult> {
  let page: Page | null = null;

  try {
    page = await createPage(context);
    const validateUrl = URLS.sessionValidate;

    logger.info('Validating existing session', { validateUrl });

    await page.goto(validateUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });

    await randomDelay(1500, 3000);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

    const currentUrl = page.url();
    const redirectedToLogin =
      /naukri\.com\/recruit\/login/i.test(currentUrl) ||
      LOGIN_FAILURE_URL_PATTERNS.some((p) => p.test(currentUrl));

    if (redirectedToLogin) {
      logger.warn('Session invalid — redirected to login', { currentUrl });
      return {
        valid: false,
        reason: 'Redirected to login page',
        redirectedToLogin: true,
      };
    }

    const loginFormVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (loginFormVisible && /login|authenticate/i.test(currentUrl)) {
      return {
        valid: false,
        reason: 'Login form visible on validation page',
        redirectedToLogin: true,
      };
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/session expired|please log in|sign in again/i.test(bodyText)) {
      return { valid: false, reason: 'Session expired message detected' };
    }

    logger.info('Session validation passed', { currentUrl });
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Session validation error', { message });
    if (page) {
      await saveScreenshot(page, 'session-validation-error').catch(() => undefined);
    }
    return { valid: false, reason: message };
  } finally {
    if (page) await page.close().catch(() => undefined);
  }
}
