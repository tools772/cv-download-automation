import type { Page } from 'playwright';
import { delay } from '../utils/delay.js';

const PROFILE_LINK_SELECTORS = [
  'a[href*="/v3/preview"]',
  'a[href*="preview"]',
  'a[href*="profileId"]',
  'a[href*="resumeId"]',
  'a[href*="candidate"]',
  'a[href*="resId"]',
  'a[href*="candId"]',
  'a[href*="/profile"]',
  '[class*="tuple"] a',
  '[class*="srp"] a',
  '[class*="result"] a',
  '[data-ttuple] a',
];

export function looksLikeCandidateProfileUrl(url: string): boolean {
  if (!/resdex\.naukri\.com|recruit\.naukri\.com/i.test(url)) return false;
  if (/resume-database-access-resdex/i.test(url)) return false;
  if (/\/recruit\/login/i.test(url)) return false;
  if (/\/v3\/(?:search\/savedSearches|folder\/list|hiringFor\/list)/i.test(url)) {
    return false;
  }
  return /candidate|profile|resumeId|profileId|resId|candId|preview|mnjuser|\/v3\/preview/i.test(
    url,
  );
}

export async function collectProfileLinks(
  page: Page,
  limit: number,
): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (let scroll = 0; scroll < 8 && urls.length < limit; scroll++) {
    for (const selector of PROFILE_LINK_SELECTORS) {
      const links = page.locator(selector);
      const count = Math.min(await links.count().catch(() => 0), limit * 10);

      for (let i = 0; i < count && urls.length < limit; i++) {
        const href = await links.nth(i).getAttribute('href').catch(() => null);
        if (!href) continue;
        try {
          const normalized = new URL(href, page.url()).href;
          if (!looksLikeCandidateProfileUrl(normalized) || seen.has(normalized)) {
            continue;
          }
          seen.add(normalized);
          urls.push(normalized);
        } catch {
          // skip invalid href
        }
      }
    }

    if (urls.length >= limit) break;
    await page.mouse.wheel(0, 2000).catch(() => undefined);
    await delay(800);
  }

  return urls.slice(0, limit);
}
