import type { BrowserContext, Page } from 'playwright';
import type { AppConfig, LoginError, LoginResult } from '../../types/index.js';
import {
  LOGIN_SELECTORS,
  LOGIN_PLACEHOLDERS,
  NAUKRI_URLS,
  LOGIN_SUCCESS_PATTERNS,
  LOGIN_FAILURE_URL_PATTERNS,
} from '../../config/naukri-selectors.js';
import { createPage } from '../../browser/launcher.js';
import { saveNaukriStorageState } from '../../session/naukriStorage.js';
import { logger } from '../../utils/logger.js';
import { saveScreenshot } from '../../utils/screenshot.js';
import { delay, randomDelay } from '../../utils/delay.js';
import { withRetry } from '../../utils/retry.js';
import {
  fillByPlaceholder,
  fillFirstVisible,
  clickLogInButton,
  findFirstVisible,
} from '../../utils/selectors.js';

async function prepareRecruitLoginPage(page: Page): Promise<void> {
  try {
    await page
      .getByPlaceholder(LOGIN_PLACEHOLDERS.email, { exact: true })
      .waitFor({ state: 'visible', timeout: 25_000 });
  } catch {
    const tab = await findFirstVisible(page, LOGIN_SELECTORS.registerLoginTab, 5000);
    if (tab) await tab.click();
    await page
      .getByPlaceholder(LOGIN_PLACEHOLDERS.email, { exact: true })
      .waitFor({ state: 'visible', timeout: 20_000 });
  }
}

async function detectCaptcha(page: Page): Promise<boolean> {
  for (const sel of LOGIN_SELECTORS.captcha) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return true;
    }
  }
  return false;
}

function isSuccessUrl(url: string): boolean {
  if (/\/recruit\/login\/?$/i.test(url)) return false;
  return LOGIN_SUCCESS_PATTERNS.some((p) => p.test(url));
}

async function waitForLoginOutcome(
  page: Page,
  config: AppConfig,
): Promise<{ success: boolean; dashboardUrl?: string; error?: LoginError }> {
  const start = Date.now();
  while (Date.now() - start < config.loginTimeoutMs) {
    const url = page.url();

    if (await detectCaptcha(page)) {
      const screenshotPath = await saveScreenshot(page, 'captcha');
      return {
        success: false,
        error: {
          code: 'CAPTCHA_DETECTED',
          message: 'Captcha detected — complete manually in headful mode',
          screenshotPath,
        },
      };
    }

    if (isSuccessUrl(url)) {
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      return { success: true, dashboardUrl: url };
    }

    if (LOGIN_FAILURE_URL_PATTERNS.some((p) => p.test(url))) {
      const errText = await page.locator('[role="alert"]').first().innerText().catch(() => '');
      if (/incorrect|invalid|password/i.test(errText)) {
        const screenshotPath = await saveScreenshot(page, 'invalid-credentials');
        return {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: errText, screenshotPath },
        };
      }
    }

    await delay(1000);
  }

  const screenshotPath = await saveScreenshot(page, 'login-timeout');
  return {
    success: false,
    error: {
      code: 'LOGIN_TIMEOUT',
      message: `Login timeout (${config.loginTimeoutMs}ms)`,
      screenshotPath,
    },
  };
}

export async function performNaukriLogin(
  context: BrowserContext,
  config: AppConfig,
  options: { userAgent: string },
): Promise<LoginResult> {
  const page = await createPage(context);
  try {
    logger.info('Naukri login started');
    await withRetry(
      () =>
        page.goto(NAUKRI_URLS.login, {
          waitUntil: 'domcontentloaded',
          timeout: config.loginTimeoutMs,
        }),
      { label: 'naukri-goto-login' },
    );
    await randomDelay(2000, 4000);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await prepareRecruitLoginPage(page);

    try {
      await fillByPlaceholder(page, LOGIN_PLACEHOLDERS.email, config.username);
    } catch {
      await fillFirstVisible(page, LOGIN_SELECTORS.username, config.username);
    }
    await randomDelay(400, 900);

    try {
      await fillByPlaceholder(page, LOGIN_PLACEHOLDERS.password, config.password);
    } catch {
      await fillFirstVisible(page, LOGIN_SELECTORS.password, config.password);
    }
    await randomDelay(500, 1100);
    await clickLogInButton(page, LOGIN_SELECTORS.submit);
    await randomDelay(2000, 3500);

    const outcome = await waitForLoginOutcome(page, config);
    if (!outcome.success) {
      logger.error('Naukri login failed', outcome.error);
      return {
        success: false,
        page,
        context,
        browser: context.browser()!,
        error: outcome.error,
      };
    }

    await saveNaukriStorageState(context, config, {
      username: config.username,
      loginUrl: NAUKRI_URLS.login,
      userAgent: options.userAgent,
      dashboardUrl: outcome.dashboardUrl,
    });

    logger.info('Naukri login successful', { dashboardUrl: outcome.dashboardUrl });
    return {
      success: true,
      page,
      context,
      browser: context.browser()!,
      dashboardUrl: outcome.dashboardUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = await saveScreenshot(page, 'login-exception').catch(() => undefined);
    return {
      success: false,
      page,
      context,
      browser: context.browser()!,
      error: { code: 'UNKNOWN', message, screenshotPath },
    };
  }
}
