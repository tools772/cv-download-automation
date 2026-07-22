import type { Page } from 'playwright';
import { CANDIDATE_LIST } from './selectors.js';
import { dismissPromotionalModals } from './dismissPopups.js';
import { delay } from '../utils/delay.js';

function isLoginLikePage(url: string, bodyText: string): boolean {
  if (/login|signin|sign-in/i.test(url)) return true;
  return /log\s*in to instahyre|sign in to continue|enter your email/i.test(bodyText);
}

/** Wait until the employer candidate list UI is interactive. */
export async function waitForCandidateListReady(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissPromotionalModals(page);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/security verification|not a bot|ray id:/i.test(bodyText)) {
      throw new Error(
        'Instahyre blocked the automated browser (Cloudflare bot check). ' +
          'Headless mode cannot pass this — use HEADLESS=false, run npm run login-instahyre, sign in manually, then fetch again.',
      );
    }
    if (isLoginLikePage(page.url(), bodyText)) {
      throw new Error(
        'Instahyre session expired or not logged in. Run: cd bulk-download-instahyre && npm run login',
      );
    }

    const hasResultsSummary = CANDIDATE_LIST.resultsSummary.test(bodyText);
    const selectAllVisible = await page
      .getByText('Select all', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    const downloadVisible = await page
      .getByText(/Download resumes/i)
      .first()
      .isVisible()
      .catch(() => false);
    const viewProfileVisible = await page
      .getByRole('link', { name: /View profile/i })
      .first()
      .isVisible()
      .catch(() => false);

    let profileCheckboxVisible = false;
    for (const selector of CANDIDATE_LIST.profileCheckbox) {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        profileCheckboxVisible = true;
        break;
      }
    }

    if (
      hasResultsSummary ||
      selectAllVisible ||
      downloadVisible ||
      viewProfileVisible ||
      profileCheckboxVisible
    ) {
      await delay(500);
      return;
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await delay(750);
  }

  const url = page.url();
  const snippet = (await page.locator('body').innerText().catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  throw new Error(
    `Candidate list did not load within ${timeoutMs}ms (${url}). ` +
      'Check INSTAHYRE_CANDIDATES_URL points to the employer candidates list, or re-run login.' +
      (snippet ? ` Page snippet: ${snippet}` : ''),
  );
}
