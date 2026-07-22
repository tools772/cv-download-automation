import type { Page } from 'playwright';
import { delay } from '../utils/delay.js';
import { logger } from '../utils/logger.js';
import { looksLikeCandidateProfileUrl } from './profileLinks.js';

/** Build v3 preview URL from profile/resume id, preserving search session params. */
export function buildV3PreviewUrl(profileId: string, searchUrl: string): string {
  const preview = new URL('https://resdex.naukri.com/v3/preview');
  preview.searchParams.set('profileId', profileId);
  try {
    const search = new URL(searchUrl);
    for (const key of ['sid', 'sidGroupId', 'agentId']) {
      const v = search.searchParams.get(key);
      if (v) preview.searchParams.set(key, v);
    }
  } catch {
    // ignore
  }
  return preview.href;
}

export async function extractHrefLinksFromDom(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls: string[] = [];
    document.querySelectorAll('a[href]').forEach((anchor) => {
      const href = (anchor as HTMLAnchorElement).href;
      if (href?.startsWith('http')) urls.push(href);
    });
    return urls;
  });
}

/** Click the first candidate tuple on Resdex v3 SRP. */
export async function openFirstSearchResult(page: Page): Promise<string | null> {
  const tupleSelectors = [
    '.tupleList .tuple',
    '[class*="tupleList"] [class*="tuple"]',
    '[class*="srp"] [class*="tuple"]',
    'div[class*="Tuple"]',
    '[class*="tuple-wrapper"]',
    '[data-ttupleid]',
    '[data-tuple-id]',
  ];

  for (const selector of tupleSelectors) {
    const tuple = page.locator(selector).first();
    if ((await tuple.count().catch(() => 0)) === 0) continue;
    if (!(await tuple.isVisible().catch(() => false))) continue;

    try {
      logger.info('Clicking first SRP tuple', { selector });
      const popupPromise = page
        .context()
        .waitForEvent('page', { timeout: 12_000 })
        .catch(() => null);

      await tuple.click({ timeout: 12_000 });
      const popup = await popupPromise;
      const target = popup ?? page;
      await target.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
      await delay(2500);

      const url = target.url();
      if (looksLikeCandidateProfileUrl(url) || /\/v3\/preview/i.test(url)) {
        logger.info('Opened candidate via SRP click', { url });
        return url;
      }
    } catch {
      // try next selector
    }
  }

  return null;
}

export async function waitForSearchResults(page: Page, timeoutMs = 45_000): Promise<void> {
  const markers = [
    '.tupleList',
    '[class*="tupleList"]',
    '[class*="tuple"]',
    'text=View Phone Number',
    'text=View CV',
  ];

  for (const selector of markers) {
    try {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    } catch {
      // next
    }
  }
}
