import type { AppConfig } from '../types/index.js';
import { createPage } from '../browser/launcher.js';
import { ensureNaukriSession } from '../auth/naukri/service.js';
import { logger } from '../utils/logger.js';
import { randomDelay } from '../utils/delay.js';
import { collectProfileLinks } from '../discovery/profileLinks.js';
import {
  extractHrefLinksFromDom,
  openFirstSearchResult,
  waitForSearchResults,
} from '../discovery/srpInteraction.js';
import { looksLikeCandidateProfileUrl } from '../discovery/profileLinks.js';

/**
 * Resolves a Resdex v3 preview URL only (no download URL construction).
 * Used by downloadAndUploadResume() which intercepts /jsprofile/download/resume.
 */
export async function resolvePreviewUrl(config: AppConfig): Promise<string> {
  const direct = process.env.TEST_PREVIEW_URL?.trim();
  if (direct) {
    logger.info('Using TEST_PREVIEW_URL');
    return direct;
  }

  const searchUrl = config.resdexSavedSearchUrl;
  if (!searchUrl) {
    throw new Error(
      'Set TEST_PREVIEW_URL or RESDEX_SAVED_SEARCH_URL in .env',
    );
  }

  const manager = await ensureNaukriSession(config);
  const page = await createPage(manager.getContext());

  try {
    logger.info('Resolving preview URL from search', { searchUrl: searchUrl.slice(0, 100) });
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined);
    await waitForSearchResults(page, 45_000).catch(() => undefined);
    await randomDelay(2000, 3500);

    let urls = await collectProfileLinks(page, 1);
    const hrefs = await extractHrefLinksFromDom(page).catch(() => []);
    for (const href of hrefs) {
      if (looksLikeCandidateProfileUrl(href) && !urls.includes(href)) {
        urls.push(href);
      }
    }

    if (urls[0]) {
      logger.info('Preview URL from search page links', { url: urls[0].slice(0, 120) });
      return urls[0];
    }

    const clicked = await openFirstSearchResult(page);
    if (clicked) {
      logger.info('Preview URL from first SRP click', { url: clicked.slice(0, 120) });
      return clicked;
    }

    throw new Error(
      'Could not resolve preview URL. Open search in browser (HEADLESS=false) or set TEST_PREVIEW_URL.',
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}
