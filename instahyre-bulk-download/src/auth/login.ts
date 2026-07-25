import type { Page } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import { INSTAHYRE_URLS, LOGIN } from '../instahyre/selectors.js';
import { dismissPromotionalModals } from '../instahyre/dismissPopups.js';
import { logger } from '../utils/logger.js';
import { saveStorageState, sessionExists } from '../session/storage.js';
import { waitForCandidateListReady } from '../instahyre/waitForCandidateList.js';
import { formatBrowserClosedError } from '../instahyre/userErrors.js';
import { waitForManualInstahyreLogin } from './manualLogin.js';

function isLoginPage(url: string): boolean {
  return /login|signin|sign-in/i.test(url);
}

async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) continue;
    if (!(await field.isVisible().catch(() => false))) continue;
    await field.fill(value);
    return true;
  }
  return false;
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click();
    return true;
  }
  return false;
}

export async function ensureLoggedIn(page: Page, config: InstahyreConfig): Promise<void> {
  if (!isLoginPage(page.url())) {
    return;
  }

  if (config.manualLogin) {
    await waitForManualInstahyreLogin(page, config);
    return;
  }

  logger.info('Instahyre login page detected — signing in');
  await fillFirstVisible(page, LOGIN.email, config.email);
  await fillFirstVisible(page, LOGIN.password, config.password);

  if (!(await clickFirstVisible(page, LOGIN.submit))) {
    throw new Error('Could not find Instahyre login submit button');
  }

  await page.waitForURL(
    (url) => !isLoginPage(url.href),
    { timeout: config.loginTimeoutMs },
  );
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

  await saveStorageState(page.context(), config);
  logger.info('Instahyre login successful');
}

async function gotoLoginAndSignIn(page: Page, config: InstahyreConfig): Promise<void> {
  if (config.manualLogin) {
    await waitForManualInstahyreLogin(page, config);
    return;
  }

  logger.info('Opening Instahyre login page', { url: INSTAHYRE_URLS.login });
  await page.goto(INSTAHYRE_URLS.login, {
    waitUntil: 'domcontentloaded',
    timeout: config.loginTimeoutMs,
  });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await ensureLoggedIn(page, config);
}

export async function openCandidatesPage(page: Page, config: InstahyreConfig): Promise<void> {
  const url = config.instahyreCandidatesUrl?.trim();
  if (!url) {
    throw new Error(
      'Missing Instahyre candidates URL. Paste the URL in Caliber Upload Resumes — do not rely on INSTAHYRE_CANDIDATES_URL in .env.',
    );
  }

  console.log(`Opening Instahyre candidates URL: ${url}`);
  logger.info('Opening Instahyre candidates page', { url });

  const expectedJobMatch = url.match(/\/employer\/candidates\/(\d+)\/\d+/i);
  const expectedJobId = expectedJobMatch?.[1];

  if (!(await sessionExists(config))) {
    await gotoLoginAndSignIn(page, config);
  }

  await gotoCandidatesUrl(page, url, config.sessionValidateTimeoutMs);

  if (isLoginPage(page.url())) {
    await gotoLoginAndSignIn(page, config);
    await gotoCandidatesUrl(page, url, config.sessionValidateTimeoutMs);
  }

  if (isLoginPage(page.url())) {
    throw new Error(
      config.manualLogin
        ? 'Still on Instahyre login page. Complete sign-in in the browser window and try again.'
        : 'Still on login page after sign-in. Check INSTAHYRE_EMAIL / INSTAHYRE_PASSWORD.',
    );
  }

  if (expectedJobId && !page.url().includes(`/candidates/${expectedJobId}/`)) {
    logger.warn('Instahyre opened a different job — forcing requested URL', {
      requested: url,
      actual: page.url(),
    });
    console.log(`Instahyre redirected to ${page.url()} — navigating to requested job ${expectedJobId}`);
    await gotoCandidatesUrl(page, url, config.sessionValidateTimeoutMs);
  }

  await dismissPromotionalModals(page);

  try {
    await waitForCandidateListReady(page, config.sessionValidateTimeoutMs);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldReauth =
      /session expired|not logged in|did not load within/i.test(message);
    if (!shouldReauth) {
      throw error;
    }
    logger.warn('Instahyre candidate list unavailable — re-authenticating', { error: message });
  }

  logger.info('Instahyre session invalid or stale — re-authenticating');
  await gotoLoginAndSignIn(page, config);
  await gotoCandidatesUrl(page, url, config.sessionValidateTimeoutMs);
  await dismissPromotionalModals(page);
  await waitForCandidateListReady(page, config.sessionValidateTimeoutMs);
}

async function gotoCandidatesUrl(page: Page, url: string, timeoutMs: number): Promise<void> {
  if (page.isClosed()) {
    throw new Error(formatBrowserClosedError('navigation'));
  }
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/target page, context or browser has been closed/i.test(message)) {
      throw new Error(formatBrowserClosedError('opening candidates page'));
    }
    throw error;
  }
}

/** Standalone: open browser, wait for manual login, save session, exit. */
export async function runManualLoginSession(config: InstahyreConfig): Promise<void> {
  const { launchBrowser, createPage } = await import('../browser/launcher.js');
  const manualConfig = { ...config, headless: false, manualLogin: true };
  const launched = await launchBrowser(manualConfig, {});
  try {
    const page = await createPage(launched.context);
    await waitForManualInstahyreLogin(page, manualConfig);
  } finally {
    await launched.close();
  }
}
