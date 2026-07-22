import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext, Page, Response } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { createPage } from '../browser/launcher.js';
import { logger } from '../utils/logger.js';
import { delay, randomDelay } from '../utils/delay.js';
import type { DiscoveredCandidate } from './types.js';
import { buildCandidateId } from './candidateId.js';
import {
  extractDownloadUrlsFromJson,
  looksLikeResumeDownloadUrl,
  pickBestDownloadUrl,
} from './downloadUrl.js';
import { collectProfileLinks, looksLikeCandidateProfileUrl } from './profileLinks.js';
import { extractCandidatesFromSearchApi } from './searchApi.js';
import {
  extractHrefLinksFromDom,
  openFirstSearchResult,
  waitForSearchResults,
} from './srpInteraction.js';

const VIEW_CV_SELECTORS = [
  'button:has-text("View CV")',
  '[role="button"]:has-text("View CV")',
  'a:has-text("View CV")',
  'button:has-text("VIEW CV")',
  'button:has-text("Download CV")',
  'a:has-text("Download CV")',
  'button:has-text("Download Resume")',
  'a:has-text("Download Resume")',
  'text=View CV',
  'text=Download CV',
];

export class ResdexDiscoveryService {
  constructor(
    private config: AppConfig,
    private context: BrowserContext,
  ) {}

  async discoverFromSavedSearch(limit?: number): Promise<DiscoveredCandidate[]> {
    const searchUrl = this.config.resdexSavedSearchUrl;
    if (!searchUrl) {
      throw new Error('Set RESDEX_SAVED_SEARCH_URL in .env for programmatic discovery');
    }

    const max = Math.max(1, Math.min(limit ?? this.config.discoveryLimit, 50));
    const searchJsonBodies: unknown[] = [];
    const searchCapturedUrls: string[] = [];

    const page = await createPage(this.context);
    const onSearchResponse = async (response: Response): Promise<void> => {
      const url = response.url();
      if (looksLikeResumeDownloadUrl(url)) searchCapturedUrls.push(url);

      const ct = response.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      if (!/resdex|recruit\.naukri|naukri/i.test(url)) return;

      try {
        const json = await response.json();
        searchJsonBodies.push(json);
        searchCapturedUrls.push(...extractDownloadUrlsFromJson(json));
      } catch {
        // skip
      }
    };

    const searchHandler = (res: Response): void => {
      void onSearchResponse(res);
    };
    page.on('response', searchHandler);

    try {
      logger.info('Opening Resdex search for discovery', { searchUrl, limit: max });
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.sessionValidateTimeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: 35_000 }).catch(() => undefined);
      await waitForSearchResults(page, 45_000).catch(() => undefined);
      await randomDelay(2000, 4000);

      logger.info('Search page network JSON captured', {
        jsonCount: searchJsonBodies.length,
        urlCount: searchCapturedUrls.length,
      });

      // 1) Try v3 search API payloads (SRP JSON)
      let discovered = extractCandidatesFromSearchApi(searchJsonBodies, searchUrl, max);
      discovered = await this.enrichWithDownloadUrls(discovered, searchJsonBodies, searchCapturedUrls);

      if (discovered.length >= max) {
        const ready = discovered.filter((c) => c.downloadUrl).slice(0, max);
        if (ready.length > 0) {
          await this.persistDiscovery(ready);
          return ready;
        }
      }

      // 2) Profile links from DOM (anchors)
      let profileUrls = await collectProfileLinks(page, max);
      const domHrefs = page.isClosed()
        ? []
        : await extractHrefLinksFromDom(page).catch(() => []);
      for (const href of domHrefs) {
        if (looksLikeCandidateProfileUrl(href) && !profileUrls.includes(href)) {
          profileUrls.push(href);
        }
      }
      profileUrls = profileUrls.slice(0, max);
      logger.info('Profile links on search page', { count: profileUrls.length });

      // 3) Click first tuple if no links (v3 SPA)
      if (profileUrls.length === 0) {
        const clickedUrl = await openFirstSearchResult(page);
        if (clickedUrl) profileUrls = [clickedUrl];
      }

      const fromProfiles: DiscoveredCandidate[] = [];
      for (let i = 0; i < profileUrls.length && fromProfiles.length < max; i++) {
        const existing = discovered.find((d) => d.profileUrl === profileUrls[i]);
        if (existing?.downloadUrl) {
          fromProfiles.push(existing);
          continue;
        }
        const resolved = await this.resolveCandidateFromProfile(
          profileUrls[i]!,
          i + 1,
          searchJsonBodies,
          searchCapturedUrls,
        );
        if (resolved) fromProfiles.push(resolved);
        await randomDelay(800, 1600);
      }

      if (fromProfiles.length === 0) {
        await this.saveDebugSnapshot(page, 'no-candidates');
        throw new Error(
          'No candidates discovered. Ensure you are logged in and the search returns results (try HEADLESS=false).',
        );
      }

      await this.persistDiscovery(fromProfiles);
      return fromProfiles.slice(0, max);
    } finally {
      page.off('response', searchHandler);
      await page.close().catch(() => undefined);
    }
  }

  /** Fill missing downloadUrl by visiting profile pages. */
  private findDownloadUrlInSearchData(
    profileUrl: string,
    jsonBodies: unknown[],
    capturedUrls: string[],
  ): string | undefined {
    const uniqMatch = profileUrl.match(/uniqId=([^&]+)/i);
    const uniqId = uniqMatch?.[1];
    const scopedUrls: string[] = [];

    if (uniqId) {
      for (const body of jsonBodies) {
        const serialized = JSON.stringify(body);
        if (serialized.includes(uniqId)) {
          scopedUrls.push(...extractDownloadUrlsFromJson(body));
        }
      }
    }

    scopedUrls.push(...capturedUrls);
    return pickBestDownloadUrl(scopedUrls.filter(looksLikeResumeDownloadUrl));
  }

  private async enrichWithDownloadUrls(
    candidates: DiscoveredCandidate[],
    jsonBodies: unknown[],
    capturedUrls: string[],
  ): Promise<DiscoveredCandidate[]> {
    const enriched: DiscoveredCandidate[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      if (c.downloadUrl) {
        enriched.push(c);
        continue;
      }
      const fromSearch = c.profileUrl
        ? this.findDownloadUrlInSearchData(c.profileUrl, jsonBodies, capturedUrls)
        : undefined;
      if (fromSearch) {
        enriched.push({ ...c, downloadUrl: fromSearch, source: 'api-json' });
        continue;
      }
      if (!c.profileUrl) continue;
      const resolved = await this.resolveCandidateFromProfile(
        c.profileUrl,
        i + 1,
        jsonBodies,
        capturedUrls,
      );
      if (resolved) {
        enriched.push({
          ...resolved,
          candidateId: c.candidateId || resolved.candidateId,
          candidateName: c.candidateName ?? resolved.candidateName,
        });
      }
      await randomDelay(600, 1200);
    }
    return enriched;
  }

  private async resolveCandidateFromProfile(
    profileUrl: string,
    index: number,
    searchJsonBodies: unknown[] = [],
    searchCapturedUrls: string[] = [],
  ): Promise<DiscoveredCandidate | null> {
    const preResolved = this.findDownloadUrlInSearchData(
      profileUrl,
      searchJsonBodies,
      searchCapturedUrls,
    );
    if (preResolved) {
      logger.info('Download URL resolved from search API data', { index });
      return {
        candidateId: buildCandidateId(profileUrl, index),
        profileUrl,
        downloadUrl: preResolved,
        discoveredAt: new Date().toISOString(),
        source: 'api-json',
      };
    }

    const page = await createPage(this.context);
    const capturedUrls: string[] = [...searchCapturedUrls];

    const onResponse = async (response: Response): Promise<void> => {
      const url = response.url();
      const contentType = response.headers()['content-type'] ?? '';

      if (looksLikeResumeDownloadUrl(url)) capturedUrls.push(url);

      if (contentType.includes('application/json')) {
        try {
          const json = await response.json();
          capturedUrls.push(...extractDownloadUrlsFromJson(json));
        } catch {
          // ignore
        }
      }
    };

    const responseHandler = (res: Response): void => {
      void onResponse(res);
    };
    page.on('response', responseHandler);
    const contextHandler = (res: Response): void => {
      void onResponse(res);
    };
    this.context.on('response', contextHandler);

    try {
      logger.info('Resolving download URL for profile', { index, profileUrl });
      await page.goto(profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.sessionValidateTimeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined);
      await page.getByText('View CV', { exact: false }).first()
        .waitFor({ state: 'visible', timeout: 25_000 })
        .catch(() => undefined);
      await delay(3000);

      let downloadUrl = await this.tryCaptureDownloadViaBrowser(
        page,
        this.context,
      );
      if (!downloadUrl) downloadUrl = pickBestDownloadUrl(capturedUrls);
      if (!downloadUrl) downloadUrl = await this.tryDomDownloadLink(page);
      if (!downloadUrl) downloadUrl = await this.tryRevealDownload(page, capturedUrls);

      if (!downloadUrl) {
        await this.saveDebugUrls(profileUrl, capturedUrls);
        logger.warn('Could not resolve download URL', {
          profileUrl: profileUrl.slice(0, 120),
          capturedCount: capturedUrls.length,
        });
        return null;
      }

      return {
        candidateId: buildCandidateId(profileUrl, index),
        candidateName: await this.readCandidateName(page),
        profileUrl,
        downloadUrl,
        discoveredAt: new Date().toISOString(),
        source: 'network',
      };
    } finally {
      page.off('response', responseHandler);
      this.context.off('response', contextHandler);
      await page.close().catch(() => undefined);
    }
  }

  /** Click View/Download CV and capture the download request URL (for Axios replay). */
  private async tryCaptureDownloadViaBrowser(
    page: Page,
    context: BrowserContext,
  ): Promise<string | undefined> {
    for (const frame of page.frames()) {
      for (const selector of VIEW_CV_SELECTORS) {
        const control = frame.locator(selector).first();
        if ((await control.count().catch(() => 0)) === 0) continue;
        if (!(await control.isVisible().catch(() => false))) continue;

        try {
          await control.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
          const downloadPromise = context.waitForEvent('download', {
            timeout: 45_000,
          });
          await control.click({ timeout: 12_000 });
          const download = await downloadPromise;
          const url = download.url();
          await download.cancel().catch(() => undefined);
          if (url?.startsWith('http')) {
            logger.info('Captured download URL from browser download event', {
              url: url.slice(0, 120),
            });
            return url;
          }
        } catch {
          // try next
        }
      }
    }
    return undefined;
  }

  private async tryDomDownloadLink(page: Page): Promise<string | undefined> {
    const anchors = page.locator('a[href*="download"], a[href*="resume"], a[href*="cv"]');
    const count = Math.min(await anchors.count().catch(() => 0), 20);
    const urls: string[] = [];

    for (let i = 0; i < count; i++) {
      const href = await anchors.nth(i).getAttribute('href').catch(() => null);
      if (!href) continue;
      try {
        const absolute = new URL(href, page.url()).href;
        if (looksLikeResumeDownloadUrl(absolute)) urls.push(absolute);
      } catch {
        // skip
      }
    }

    return pickBestDownloadUrl(urls);
  }

  private async tryRevealDownload(
    page: Page,
    capturedUrls: string[],
  ): Promise<string | undefined> {
    for (const selector of VIEW_CV_SELECTORS) {
      const control = page.locator(selector).first();
      if ((await control.count()) === 0) continue;
      if (!(await control.isVisible().catch(() => false))) continue;

      try {
        await control.click({ timeout: 8000 });
        await delay(2000);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
        const domUrl = await this.tryDomDownloadLink(page);
        if (domUrl) return domUrl;
      } catch {
        // next
      }
    }

    return pickBestDownloadUrl(capturedUrls);
  }

  private async readCandidateName(page: Page): Promise<string | undefined> {
    for (const selector of ['h1', '[class*="candidate-name"]', '[class*="profile-name"]']) {
      const loc = page.locator(selector).first();
      if ((await loc.count()) === 0) continue;
      const text = await loc.innerText({ timeout: 2000 }).catch(() => '');
      const cleaned = text.trim().split('\n')[0]?.trim();
      if (cleaned) return cleaned;
    }
    return undefined;
  }

  private async persistDiscovery(candidates: DiscoveredCandidate[]): Promise<void> {
    const outPath = path.join(this.config.sessionDir, 'discovered-candidates.json');
    await fs.writeJson(
      outPath,
      { discoveredAt: new Date().toISOString(), candidates },
      { spaces: 2 },
    );
    logger.info('Discovery results saved', { outPath, count: candidates.length });
  }

  private async saveDebugUrls(profileUrl: string, urls: string[]): Promise<void> {
    const debugDir = path.join(this.config.sessionDir, 'debug');
    await fs.ensureDir(debugDir);
    await fs.writeJson(
      path.join(debugDir, `capture-urls-${Date.now()}.json`),
      { profileUrl, urls: urls.slice(0, 50) },
      { spaces: 2 },
    );
  }

  private async saveDebugSnapshot(page: Page, label: string): Promise<void> {
    const debugDir = path.join(this.config.sessionDir, 'debug');
    await fs.ensureDir(debugDir);
    const stamp = Date.now();
    await page
      .screenshot({ path: path.join(debugDir, `${stamp}_${label}.png`), fullPage: true })
      .catch(() => undefined);
  }
}

export async function discoverCandidates(
  config: AppConfig,
  context: BrowserContext,
  limit?: number,
): Promise<DiscoveredCandidate[]> {
  const service = new ResdexDiscoveryService(config, context);
  return service.discoverFromSavedSearch(limit);
}
