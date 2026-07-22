import type { Page } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import { INSTAHYRE_URLS } from '../instahyre/selectors.js';
import { waitForCandidateListReady } from '../instahyre/waitForCandidateList.js';
import { dismissPromotionalModals } from '../instahyre/dismissPopups.js';
import { saveStorageState } from '../session/storage.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

function isLoginLikePage(url: string, bodyText: string): boolean {
  if (/login|signin|sign-in/i.test(url)) return true;
  return /log\s*in to instahyre|sign in to continue|enter your email/i.test(bodyText);
}

function isEmployerArea(url: string): boolean {
  return /instahyre\.com\/employer/i.test(url);
}

/** Wait for a human to complete Instahyre login in the visible Playwright browser. */
export async function waitForManualInstahyreLogin(
  page: Page,
  config: InstahyreConfig,
): Promise<void> {
  if (config.headless) {
    throw new Error(
      'INSTAHYRE_MANUAL_LOGIN requires HEADLESS=false so you can sign in in the browser window.',
    );
  }

  const timeoutMs = config.manualLoginTimeoutMs;
  console.log('\n=== Instahyre manual login ===');
  console.log('Sign in to Instahyre in the browser window that opened.');
  console.log('Leave the window open — automation continues after login is detected.');
  console.log(`Waiting up to ${Math.round(timeoutMs / 60_000)} minutes...\n`);

  const startUrl = config.instahyreCandidatesUrl ?? INSTAHYRE_URLS.login;
  if (!isLoginLikePage(page.url(), '')) {
    await page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.loginTimeoutMs,
    });
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissPromotionalModals(page);

    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    if (!isLoginLikePage(url, bodyText) && isEmployerArea(url)) {
      try {
        await waitForCandidateListReady(page, 8000);
      } catch {
        // Employer area but not candidates list yet — still accept login
        if (!/employer\/candidates/i.test(url)) {
          await delay(1000);
          continue;
        }
      }
      await saveStorageState(page.context(), config);
      logger.info('Manual Instahyre login complete — session saved');
      console.log('Login detected. Continuing automation...\n');
      return;
    }

    try {
      await waitForCandidateListReady(page, 2000);
      await saveStorageState(page.context(), config);
      logger.info('Manual Instahyre login complete (candidate list visible) — session saved');
      console.log('Candidate list detected. Continuing automation...\n');
      return;
    } catch {
      // Still on login or loading
    }

    await delay(1000);
  }

  throw new Error(
    `Manual Instahyre login timed out after ${timeoutMs}ms. ` +
      'Complete login in the browser window, or run: npm run login-instahyre',
  );
}
