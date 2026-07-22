import type { BrowserContext, Page } from 'playwright';
import type { AppConfig, LoginError, LoginResult } from '../types/index.js';
import {
  LOGIN_SELECTORS,
  LOGIN_SUCCESS_PATTERNS,
  LOGIN_FAILURE_URL_PATTERNS,
  LOGIN_PLACEHOLDERS,
  URLS,
} from '../config/selectors.js';
import { createPage } from '../browser/launcher.js';
import { persistContextSession } from '../session/storage.js';
import { logger } from '../utils/logger.js';
import { saveScreenshot } from '../utils/screenshot.js';
import { randomDelay, delay } from '../utils/delay.js';
import { withRetry } from '../utils/retry.js';
import {
  clickLogInButton,
  fillRecruitLoginField,
  findFirstVisible,
} from '../utils/selectors.js';

async function detectCaptcha(page: Page): Promise<boolean> {
  for (const selector of LOGIN_SELECTORS.captcha) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      try {
        if (await locator.isVisible({ timeout: 1000 })) return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

async function detectLoginError(page: Page): Promise<string | null> {
  for (const selector of LOGIN_SELECTORS.errorMessage) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    try {
      if (await locator.isVisible({ timeout: 1000 })) {
        const text = await locator.innerText();
        if (text.trim()) return text.trim();
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function acceptTermsIfPresent(page: Page): Promise<void> {
  const checkbox = await findFirstVisible(page, LOGIN_SELECTORS.termsCheckbox, 3000);
  if (!checkbox) return;
  const checked = await checkbox.isChecked().catch(() => true);
  if (!checked) {
    await checkbox.check({ force: true }).catch(() => undefined);
    await randomDelay(200, 500);
  }
}

/** Open recruit/login and ensure the "Register/Log in" form is visible. */
async function prepareRecruitLoginPage(page: Page): Promise<void> {
  logger.info('Preparing recruit login form', { url: URLS.login });

  await page
    .getByPlaceholder(LOGIN_PLACEHOLDERS.email, { exact: true })
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(async () => {
      const tab = await findFirstVisible(
        page,
        LOGIN_SELECTORS.registerLoginTab,
        5000,
      );
      if (tab) {
        await tab.click();
        await randomDelay(400, 800);
      }
      await page
        .getByPlaceholder(LOGIN_PLACEHOLDERS.email, { exact: true })
        .waitFor({ state: 'visible', timeout: 20_000 });
    });

  logger.info('Recruit login form ready');
}

function isLoginSuccessUrl(url: string): boolean {
  if (/\/recruit\/login\/?$/i.test(url)) return false;
  return LOGIN_SUCCESS_PATTERNS.some((p) => p.test(url));
}

async function isLoginSuccessDom(page: Page): Promise<boolean> {
  if (isLoginSuccessUrl(page.url())) return true;

  const onRecruitLogin = /naukri\.com\/recruit\/login/i.test(page.url());
  if (!onRecruitLogin) {
    return LOGIN_SUCCESS_PATTERNS.some((p) => p.test(page.url()));
  }

  const emailVisible = await page
    .getByPlaceholder(LOGIN_PLACEHOLDERS.email, { exact: true })
    .isVisible()
    .catch(() => false);

  const logInVisible = await page
    .getByRole('button', { name: /^Log in$/i })
    .isVisible()
    .catch(() => false);

  return !emailVisible && !logInVisible;
}

async function waitForLoginOutcome(
  page: Page,
  config: AppConfig,
): Promise<{ success: boolean; dashboardUrl?: string; error?: LoginError }> {
  const start = Date.now();
  const visited = new Set<string>();
  let authRedirectCount = 0;

  while (Date.now() - start < config.loginTimeoutMs) {
    const url = page.url();
    visited.add(url);

    if (await detectCaptcha(page)) {
      const screenshotPath = await saveScreenshot(page, 'captcha-detected');
      return {
        success: false,
        error: {
          code: 'CAPTCHA_DETECTED',
          message: 'Captcha or security challenge detected. Manual intervention required.',
          screenshotPath,
        },
      };
    }

    const loginError = await detectLoginError(page);
    if (loginError && /incorrect|invalid|wrong|password|username|email/i.test(loginError)) {
      const screenshotPath = await saveScreenshot(page, 'invalid-credentials');
      return {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: loginError,
          screenshotPath,
        },
      };
    }

    if (isLoginSuccessUrl(url) || (await isLoginSuccessDom(page))) {
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      return { success: true, dashboardUrl: page.url() };
    }

    if (LOGIN_FAILURE_URL_PATTERNS.some((p) => p.test(url))) {
      authRedirectCount += 1;
      if (authRedirectCount > 8) {
        const screenshotPath = await saveScreenshot(page, 'redirect-loop');
        return {
          success: false,
          error: {
            code: 'REDIRECT_LOOP',
            message: `Too many auth redirects. Last URL: ${url}`,
            screenshotPath,
          },
        };
      }
    }

    if (visited.size > 20) {
      const screenshotPath = await saveScreenshot(page, 'redirect-loop');
      return {
        success: false,
        error: {
          code: 'REDIRECT_LOOP',
          message: 'Excessive unique URLs during login',
          screenshotPath,
        },
      };
    }

    await delay(1000);
  }

  const screenshotPath = await saveScreenshot(page, 'login-timeout');
  return {
    success: false,
    error: {
      code: 'LOGIN_TIMEOUT',
      message: `Login did not complete within ${config.loginTimeoutMs}ms`,
      screenshotPath,
    },
  };
}

export async function performLogin(
  context: BrowserContext,
  config: AppConfig,
  options: { userAgent: string },
): Promise<LoginResult> {
  const page = await createPage(context);

  try {
    logger.info('Starting Naukri Recruiter login flow', { loginUrl: URLS.login });

    await withRetry(
      async () => {
        await page.goto(URLS.login, {
          waitUntil: 'domcontentloaded',
          timeout: config.loginTimeoutMs,
        });
      },
      { label: 'navigate-login', maxAttempts: 3 },
    );

    await randomDelay(2000, 4000);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

    await prepareRecruitLoginPage(page);

    await fillRecruitLoginField(
      page,
      'email',
      config.username,
      LOGIN_SELECTORS.username,
      { staggerMs: [60, 140] },
    );
    await randomDelay(400, 900);

    await fillRecruitLoginField(
      page,
      'password',
      config.password,
      LOGIN_SELECTORS.password,
      { staggerMs: [70, 160] },
    );
    await randomDelay(500, 1100);

    await acceptTermsIfPresent(page);
    await clickLogInButton(page, LOGIN_SELECTORS.submit);

    logger.info('Login form submitted, waiting for dashboard');
    await randomDelay(2000, 3500);

    const outcome = await waitForLoginOutcome(page, config);

    if (!outcome.success || outcome.error) {
      logger.error('Login failed', outcome.error);
      return {
        success: false,
        page,
        context,
        browser: context.browser()!,
        error: outcome.error,
      };
    }

    await persistContextSession(context, config, {
      username: config.username,
      loginUrl: URLS.login,
      userAgent: options.userAgent,
      dashboardUrl: outcome.dashboardUrl,
    });

    logger.info('Login successful', { dashboardUrl: outcome.dashboardUrl });

    return {
      success: true,
      page,
      context,
      browser: context.browser()!,
      dashboardUrl: outcome.dashboardUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = await saveScreenshot(page, 'login-exception').catch(
      () => undefined,
    );

    logger.error('Login exception', { message, screenshotPath });

    return {
      success: false,
      page,
      context,
      browser: context.browser()!,
      error: {
        code: 'UNKNOWN',
        message,
        screenshotPath,
      },
    };
  }
}
