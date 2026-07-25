import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext, Download, Frame, Locator, Page } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { createSessionManager } from '../session/manager.js';
import { createPage, closeExtraPages } from '../browser/launcher.js';
import {
  logManualSaveResult,
  watchAfterDownloadClick,
} from '../browser/manualDownload.js';
import {
  isDriveUploadEnabled,
  uploadLocalResumeToDrive,
  type DriveUploadResult,
} from '../drive/index.js';
import {
  assertAttachedCvAvailable,
  getSkipReasonIfNoCvOnProfile,
  NoAttachedCvError,
} from './detectAttachedCv.js';
import { RESUME_DOWNLOAD_TIMEOUT_MS } from './constants.js';
import { applyResdexSearchFilters, withActiveInDays } from './applyResdexFilters.js';
import { printProfileStatus } from '../utils/runOutput.js';
import { delay, randomDelay } from '../utils/delay.js';
import { logger } from '../utils/logger.js';
import { createDownloadedProfilesHistory, normalizeCandidateName } from '../storage/downloadedProfiles.js';

/** Returned when we only click Download CV and let the browser handle Save As. */
export const MANUAL_CLICK_SENTINEL = '__manual_download_click__';

export function isManualClickResult(value: string): boolean {
  return value === MANUAL_CLICK_SENTINEL;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** A profile counts as a real download when a resume file was actually saved/uploaded. */
function isSuccessfulDownload(result: ResdexResumeDownloadResult): boolean {
  return (
    result.status === 'uploaded' ||
    (result.status === 'clicked' && Boolean(result.localPath))
  );
}

export interface ResdexResumeDownloadResult {
  rank: number;
  profileUrl: string;
  candidateName?: string;
  localPath?: string;
  driveFile?: DriveUploadResult;
  status: 'uploaded' | 'clicked' | 'skipped' | 'failed';
  error?: string;
  driveUploadError?: string;
  skipReason?: string;
}

const PROFILE_LINK_SELECTORS = [
  'a[href*="candidate"]',
  'a[href*="profileId"]',
  'a[href*="resumeId"]',
  'a[href*="resId"]',
  'a[href*="candId"]',
  'a[href*="/preview"]',
  'a[href*="/profile"]',
  '[data-testid*="candidate"] a',
  '[data-testid*="resume"] a',
  '[data-testid*="profile"] a',
  '[class*="candidate"] a',
  '[class*="resume"] a',
  '[class*="profile"] a',
  '[class*="srp"] a',
  '[class*="result"] a',
  '[class*="tuple"] a',
];

/**
 * Naukri often requires "View CV" (credit) before download; controls may live in iframes.
 * Prefer specific labels so we do not click unrelated "Download" buttons.
 */
const VIEW_CV_OPEN_SELECTORS = [
  'button:has-text("View CV")',
  '[role="button"]:has-text("View CV")',
  'a:has-text("View CV")',
  'button:has-text("VIEW CV")',
  'text=/^\\s*View\\s+CV\\s*$/i',
  'button:has-text("View Resume")',
  '[role="button"]:has-text("View Resume")',
  'a:has-text("View Resume")',
  'button:has-text("View document")',
  'button:has-text("Open CV")',
  'button:has-text("See CV")',
  'button:has-text("Preview CV")',
  'button:has-text("View primary CV")',
  'button:has-text("View Primary CV")',
  'button:has-text("View attached CV")',
  'button:has-text("View Attached CV")',
];

/** Tab / nav to open the Attached CV page on the candidate profile (human flow). */
const ATTACHED_CV_TAB_SELECTORS = [
  '[role="tab"]:has-text("Attached CV")',
  'button:has-text("Attached CV")',
  'a:has-text("Attached CV")',
  'div[role="tab"]:has-text("Attached CV")',
  'text=/^\\s*Attached\\s+CV\\s*$/i',
  '[data-testid*="attached-cv"]',
  '[class*="attached-cv"]:has-text("Attached CV")',
  '[class*="attachedCv"]:has-text("Attached CV")',
];

/** Panel/container shown after Attached CV is active — download button lives here. */
const ATTACHED_CV_PANEL_SELECTORS = [
  '[class*="attached-cv"]',
  '[class*="attachedCv"]',
  '[class*="AttachedCv"]',
  '[data-testid*="attached-cv"]',
  '[id*="attached-cv" i]',
  '[id*="attachedCv"]',
  'section:has-text("Attached CV")',
  'div:has-text("Attached CV"):has(button:has-text("Download"))',
];

/** Download CV on the Attached CV page only (mimics user click). */
const ATTACHED_CV_DOWNLOAD_SELECTORS = [
  'button:has-text("Download CV")',
  '[role="button"]:has-text("Download CV")',
  'a:has-text("Download CV")',
  'button:has-text("Download attached CV")',
  'button:has-text("Download Resume")',
  'button[aria-label*="download" i]',
  'a[download]',
];

// Fallback when Attached CV tab/panel cannot be found.
const RESUME_DOWNLOAD_SELECTORS = [
  'button:has-text("Download CV")',
  '[role="button"]:has-text("Download CV")',
  'button:has-text("Download Resume")',
  '[role="button"]:has-text("Download Resume")',
  'a:has-text("Download CV")',
  'text=/^\\s*Download\\s+CV\\s*$/i',
  'a[download]',
  'a[href*="download"]',
];

const CANDIDATE_NAME_SELECTORS = [
  'h1',
  '[data-testid*="name"]',
  '[class*="candidateName"]',
  '[class*="candidate-name"]',
  '[class*="profile-name"]',
];

/**
 * Checks if the current page is showing a captcha.
 * Returns true if captcha detected — caller should pause for manual solve.
 */
async function isCaptchaPresent(page: Page): Promise<boolean> {
  const captchaSignals = [
    // reCAPTCHA
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    '.g-recaptcha',
    '#captcha',
    // Naukri-specific
    'text=/verify you are human/i',
    'text=/complete the security check/i',
    'text=/captcha/i',
    'text=/robot/i',
    // Cloudflare
    'text=/checking your browser/i',
    '[id*="challenge"]',
    '[class*="captcha"]',
  ];

  for (const signal of captchaSignals) {
    const visible = await page
      .locator(signal)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

/**
 * Pauses execution and waits for the user to manually solve the captcha.
 * Polls until captcha disappears, up to 5 minutes.
 */
async function waitForCaptchaSolve(page: Page, rank: number): Promise<void> {
  console.log(`[${rank}] CAPTCHA — solve in browser (auto-resumes when done)`);
  logger.warn('Captcha detected', { rank });

  logger.warn('Captcha detected — waiting for manual solve', { rank });

  const timeoutMs = 5 * 60 * 1000; // 5 minutes
  const pollMs = 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await delay(pollMs);
    const stillPresent = await isCaptchaPresent(page);
    if (!stillPresent) {
      logger.info('Captcha solved by user', { rank });
      // Wait for page to settle after captcha solve
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await delay(1_000);
      return;
    }
  }

  // Timed out — throw so the profile is marked failed, not skipped
  throw new Error('Captcha not solved within 5 minutes — profile skipped');
}

async function humanPause(rank: number): Promise<void> {
  // Every 10 downloads — take a longer break (simulates reading a profile)
  if (rank % 10 === 0) {
    const longBreak = 15_000 + Math.random() * 20_000; // 15-35 seconds
    logger.info('Human pause after downloads', { rank, seconds: Math.round(longBreak / 1000) });
    await delay(longBreak);
    return;
  }

  // Every 25 downloads — take an even longer break
  if (rank % 25 === 0) {
    const bigBreak = 45_000 + Math.random() * 45_000; // 45-90 seconds
    logger.info('Long human pause after downloads', { rank, seconds: Math.round(bigBreak / 1000) });
    await delay(bigBreak);
    return;
  }

  // Normal delay between downloads — randomized
  const base = 2_000 + Math.random() * 3_000; // 2-5 seconds base
  const spike = Math.random() < 0.2 ? Math.random() * 8_000 : 0; // 20% chance of 0-8s extra spike
  await delay(base + spike);
}

async function moveMouseNaturally(
  page: Page,
  target: ReturnType<Page['locator']>
): Promise<void> {
  try {
    const box = await target.boundingBox({ timeout: 3_000 });
    if (!box) return;

    // Current mouse position (randomized start)
    const startX = Math.random() * 800 + 100;
    const startY = Math.random() * 400 + 100;

    // Target with slight human inaccuracy
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    // Move in steps (curved path)
    const steps = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Ease in-out curve
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      // Add slight wobble
      const wobbleX = (Math.random() - 0.5) * 4;
      const wobbleY = (Math.random() - 0.5) * 4;

      await page.mouse.move(
        startX + (targetX - startX) * ease + wobbleX,
        startY + (targetY - startY) * ease + wobbleY,
      );
      await delay(20 + Math.random() * 30);
    }
  } catch {
    // Non-critical — skip if it fails
  }
}

async function saveProfileUrlsDebug(urls: string[], sessionDir: string): Promise<void> {
  const debugDir = path.join(sessionDir, 'debug');
  await fs.ensureDir(debugDir);
  const outPath = path.join(debugDir, 'collected-profile-urls-DArch.json');
  await fs.writeJson(
    outPath,
    {
      total: urls.length,
      timestamp: new Date().toISOString(),
      urls: urls.map((url, i) => ({
        rank: i + 1,
        tupleIndex: new URL(url).searchParams.get('tupleIndex'),
        pageNo: new URL(url).searchParams.get('pageNo') ?? 'n/a',
        url,
      })),
    },
    { spaces: 2 },
  );
  // console.log(`\n📁 Profile URLs saved to: ${outPath}`);
  logger.debug('Profile URLs debug saved', { outPath });
}

function isOnSubuserConflictPage(pageUrl: string): boolean {
  return /resdex\.naukri\.com\/v2\/(ChangeLogin|ResetLogin)/i.test(pageUrl);
}

function extractReqUrl(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).searchParams.get('requrl');
  } catch {
    return null;
  }
}

function buildResetLoginUrl(requrl: string): string {
  return `https://resdex.naukri.com/v2/ResetLogin/displayResetLogin?requrl=${encodeURIComponent(requrl)}`;
}

/** Click or navigate when Naukri header overlays intercept pointer events. */
async function gotoResilient(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2 && /interrupted|Navigation/i.test(msg)) {
        logger.warn('Navigation interrupted, retrying', { url, attempt: attempt + 1 });
        await delay(1_500);
        continue;
      }
      throw err;
    }
  }
}

async function clickResilient(page: Page, locator: Locator): Promise<boolean> {
  const href = await locator.getAttribute('href').catch(() => null);
  if (href && !/^javascript:/i.test(href)) {
    const target = new URL(href, page.url()).href;
    await gotoResilient(page, target);
    return true;
  }

  try {
    await locator.click({ timeout: 5_000, force: true });
    return true;
  } catch {
    try {
      await locator.evaluate((el) => (el as HTMLElement).click());
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForSubuserResolution(
  page: Page,
  config: AppConfig,
  savedSearchUrl: string,
): Promise<void> {
  if (!isOnSubuserConflictPage(page.url())) return;

  logger.info('Waiting for subuser conflict resolution in Chrome');
  console.log('\n=== Naukri subuser conflict ===');
  console.log('Choose a subuser or click Reset Subuser → Reset & Login in Chrome.\n');

  const deadline = Date.now() + config.loginTimeoutMs;
  while (Date.now() < deadline) {
    if (!isOnSubuserConflictPage(page.url())) {
      logger.info('Subuser conflict resolved manually');
      return;
    }
    await delay(1_000);
  }

  if (isOnSubuserConflictPage(page.url())) {
    await gotoResilient(page, savedSearchUrl);
    if (!isOnSubuserConflictPage(page.url())) return;
  }

  throw new Error(
    'Naukri subuser conflict not resolved. Reset subuser in Chrome, then retry the fetch.',
  );
}

interface SubuserConflictResult {
  detected: boolean;
  resolved: boolean;
}

/**
 * Detects and handles the Resdex "Someone is already logged in" subuser conflict page.
 * Navigates to Reset Subuser (avoids overlay-blocked tab clicks) → Reset & Login.
 */
async function handleSubuserConflict(page: Page): Promise<SubuserConflictResult> {
  const pageUrl = page.url();
  const conflictText = await page
    .locator('text=/Someone is already logged into Resdex|Available subuser|Resdex Change Login/i')
    .first()
    .isVisible()
    .catch(() => false);

  if (!isOnSubuserConflictPage(pageUrl) && !conflictText) {
    return { detected: false, resolved: false };
  }

  logger.info('Subuser conflict page detected — attempting auto-reset');
  logger.warn('Subuser conflict detected — auto-resetting');

  const requrl = extractReqUrl(pageUrl) ?? extractReqUrl(page.url());

  try {
    if (requrl && !/\/ResetLogin\/displayResetLogin/i.test(page.url())) {
      await gotoResilient(page, buildResetLoginUrl(requrl));
      await delay(1_000);
      logger.info('Navigated to Reset Subuser page', { url: page.url() });
    } else if (!/\/ResetLogin\/displayResetLogin/i.test(page.url())) {
      const resetTab = page
        .locator('a[href*="ResetLogin/displayResetLogin"], a:has-text("Reset Subuser")')
        .first();
      if (!(await clickResilient(page, resetTab))) {
        logger.warn('Could not open Reset Subuser tab');
        return { detected: true, resolved: false };
      }
      await delay(1_000);
      logger.info('Opened Reset Subuser tab');
    }

    const resetBtn = page
      .locator(
        'button:has-text("Reset & Login"), [role="button"]:has-text("Reset & Login"), input[value*="Reset"], a:has-text("Reset & Login")',
      )
      .first();

    const btnVisible = await resetBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      logger.warn('Reset & Login button not found on reset page');
      return { detected: true, resolved: false };
    }

    if (!(await clickResilient(page, resetBtn))) {
      logger.warn('Reset & Login button click failed');
      return { detected: true, resolved: false };
    }
    logger.info('Clicked Reset & Login');

    await page
      .waitForURL(
        (url) => {
          const s = url.toString();
          if (/ChangeLogin|ResetLogin/i.test(s)) return false;
          if (requrl && s.includes(decodeURIComponent(requrl))) return true;
          return /resdex\.naukri\.com\/v3/i.test(s);
        },
        { timeout: 20_000 },
      )
      .catch(() => undefined);

    if (isOnSubuserConflictPage(page.url()) && requrl) {
      logger.info('Navigating directly to saved search after reset', { requrl });
      await gotoResilient(page, requrl);
    }

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const finalUrl = page.url();
    logger.info('Post-reset URL', { url: finalUrl });

    if (isOnSubuserConflictPage(finalUrl) || /recruit\/login/i.test(finalUrl)) {
      logger.warn('Still on conflict/login page after subuser reset');
      return { detected: true, resolved: false };
    }

    logger.info('Subuser conflict resolved');
    return { detected: true, resolved: true };
  } catch (err) {
    logger.error('Failed to handle subuser conflict', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { detected: true, resolved: false };
  }
}

export async function downloadTopResdexResumes(
  config: AppConfig,
): Promise<ResdexResumeDownloadResult[]> {
  if (!config.resdexSavedSearchUrl) {
    throw new Error('Missing RESDEX_SAVED_SEARCH_URL.');
  }

  if (config.manualDownloadSave) {
    await fs.ensureDir(config.localSaveDir!);
    logger.info('Manual download mode', { localSaveDir: config.localSaveDir });
  }

  if (isDriveUploadEnabled(config)) {
    logger.info('Drive upload after download enabled', {
      folderId: config.googleDriveFolderId,
    });
  }

  const manager = await createSessionManager(config);
  try {
    const context = await manager.ensureAuthenticated();
    const page = await createPage(context);
    const limit = Math.max(1, config.downloadLimit);

    const searchUrl = withActiveInDays(config.resdexSavedSearchUrl!);
    if (searchUrl !== config.resdexSavedSearchUrl) {
      logger.info('Rewrote Resdex URL Active in to 30 days', {
        from: config.resdexSavedSearchUrl,
        to: searchUrl,
      });
      console.log('Naukri: set Active in=30 via URL (was different in saved search link)');
    }

    logger.info('Opening Resdex saved search/folder', {
      url: searchUrl,
      downloadLimit: config.downloadLimit,
      limit,
    });

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

    await waitForResdexAccess(page, config);

    // ── Handle subuser conflict if present ──────────────────────────────────
    const subuser = await handleSubuserConflict(page);
    if (subuser.detected && !subuser.resolved) {
      await waitForSubuserResolution(page, config, searchUrl);
    }
    if (
      subuser.detected ||
      isOnSubuserConflictPage(page.url()) ||
      !/resdex\.naukri\.com\/v3\/search/i.test(page.url())
    ) {
      logger.info('Re-navigating to saved search after subuser reset');
      await gotoResilient(page, searchUrl);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }

    // Subuser reset often drops activeIn back to the saved-search value (e.g. 23).
    // Force the rewritten URL again before filters/collection.
    if (!/activeIn=30\b/i.test(page.url())) {
      const corrected = withActiveInDays(page.url() || searchUrl);
      logger.info('Re-applying Active in=30 after navigation drift', {
        from: page.url(),
        to: corrected,
      });
      console.log('Naukri: re-applied Active in=30 after subuser/login redirected away');
      await gotoResilient(page, corrected);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }

    const filterResult = await applyResdexSearchFilters(page);
    if (!filterResult.ok) {
      await saveResdexDebugSnapshot(page, config, 'filters-not-applied');
      throw new Error(
        `Naukri filters not applied — refusing to pick profiles. ${filterResult.reason ?? ''}`.trim(),
      );
    }

    console.log('Naukri: filters ready — indexing result page…');

    // Dedup across runs by candidate name — Naukri preview URLs carry no stable
    // per-candidate id, so we track names we've already downloaded and skip them.
    const skipDownloaded = parseBool(process.env.NAUKRI_SKIP_DOWNLOADED, true);
    const history = createDownloadedProfilesHistory(config);
    if (skipDownloaded) {
      await history.load();
      // Recognize resumes downloaded before dedup existed (or in earlier runs)
      // by seeding from files already on disk, so we don't re-fetch them.
      const seedDirs = [
        config.localSaveDir,
        path.join(config.sessionDir, 'downloads'),
      ].filter((d): d is string => Boolean(d));
      const seeded = await history.seedFromDirectories(seedDirs);
      logger.info('Loaded downloaded-profiles history', {
        knownCandidates: history.size(),
        seededFromDisk: seeded,
      });
    }

    // Collect a small buffer above the requested count so we can skip
    // already-downloaded / no-CV profiles — but do NOT open dozens of tabs
    // when the user only asked for 1 CV.
    const maxAttempts = Math.min(
      40,
      limit + Math.min(5, Math.max(2, limit)),
    );
    const poolTarget = skipDownloaded
      ? Math.min(
          40,
          Math.max(maxAttempts, limit + Math.max(8, Math.min(history.size() + 5, 20))),
        )
      : limit;
    const skipNameOnResultsPage = skipDownloaded
      ? (name: string | undefined) => history.has(name)
      : undefined;

    logger.info('Indexing search page for profile links', {
      poolTarget,
      maxAttempts,
      limit,
      skipKnownNames: Boolean(skipNameOnResultsPage),
    });
    const profileUrls = await collectProfileLinks(page, poolTarget, skipNameOnResultsPage);

    // debug 
    await saveProfileUrlsDebug(profileUrls, config.sessionDir);

    if (profileUrls.length === 0) {
      await saveResdexDebugSnapshot(page, config, 'no-candidate-links');
      throw new Error(
        'No candidate profile links found. Open the saved search in headful mode and update PROFILE_LINK_SELECTORS.',
      );
    }

    logger.info('Collected candidate profile links', {
      count: profileUrls.length,
    });
    console.log(`totalDiscovered=${profileUrls.length}`);

    // const results: ResdexResumeDownloadResult[] = [];

    // for (let i = 0; i < profileUrls.length; i++) {
    //   results.push(await processProfile(context, config, profileUrls[i]!, i + 1));
    //   // await randomDelay(400, 900);
    //   // Long break every 20 downloads to avoid captcha
    //   if ((i + 1) % 20 === 0 && i + 1 < profileUrls.length) {
    //     console.log(`\n☕ Preventive break after ${i + 1} downloads (2 min)...\n`);
    //     await delay(120_000);
    //   } else {
    //     // await randomDelay(400, 900);
    //   await randomIdleBehavior(page);   // ← add this
    //   await humanPause(i + 1); // human pause
    //   }
    // }
    const startRank = Math.max(1, config.downloadStartRank ?? 1);
    const startIndex = startRank - 1; // convert to 0-based
    if (startIndex >= profileUrls.length) {
      logger.warn('DOWNLOAD_START_RANK exceeds collected profiles', {
        startRank,
        totalCollected: profileUrls.length,
      });
      return [];
    }

    logger.info('Starting downloads from rank', {
      startRank,
      startIndex,
      poolSize: profileUrls.length,
      target: limit,
      maxAttempts,
    });

    const results: ResdexResumeDownloadResult[] = [];
    let newDownloads = 0;
    let skippedDuplicates = 0;
    // Claim names as soon as we decide to process them so the same person cannot
    // be downloaded twice in this fetch (even before history.persist finishes).
    const claimedThisRun = new Set<string>();
    const isAlreadyDownloaded = skipDownloaded
      ? (name: string | undefined) => {
          const key = normalizeCandidateName(name);
          if (!key) return false;
          if (history.has(name) || claimedThisRun.has(key)) return true;
          return false;
        }
      : (name: string | undefined) => {
          const key = normalizeCandidateName(name);
          return key ? claimedThisRun.has(key) : false;
        };
    const claimName = (name: string | undefined) => {
      const key = normalizeCandidateName(name);
      if (key) claimedThisRun.add(key);
    };

    for (let i = startIndex; i < profileUrls.length; i++) {
      if (newDownloads >= limit) {
        logger.info('Reached requested download count', { limit, newDownloads });
        break;
      }

      const attempt = i - startIndex + 1;
      if (attempt > maxAttempts) {
        logger.warn('Stopped after max profile attempts without reaching requested count', {
          maxAttempts,
          newDownloads,
          limit,
        });
        console.log(
          `Naukri: stopped after trying ${maxAttempts} profile(s) (requested ${limit} CV(s), got ${newDownloads})`,
        );
        break;
      }

      const rank = i + 1;
      const result = await processProfile(
        context,
        page,
        config,
        profileUrls[i]!,
        rank,
        isAlreadyDownloaded,
        claimName,
      );
      results.push(result);
      printProfileStatus(result);

      if (
        result.status === 'skipped' &&
        result.skipReason?.includes('already downloaded')
      ) {
        skippedDuplicates += 1;
        // Duplicates are cheap to skip — keep scanning without a long pause.
        await randomDelay(400, 900);
        continue;
      }

      if (isSuccessfulDownload(result)) {
        newDownloads += 1;
        claimName(result.candidateName);
        if (skipDownloaded) {
          await history.record(result.candidateName);
        }
      }

      // Preventive break every 20 actual downloads
      if (newDownloads > 0 && newDownloads % 20 === 0 && newDownloads < limit) {
        logger.info('Preventive break after batch of downloads', { newDownloads });
        await delay(120_000);
      } else {
        await humanPause(i + 1); // human pause
        // await randomDelay(400, 900);
      }
    }

    if (skippedDuplicates > 0) {
      logger.info('Skipped already-downloaded candidates', {
        skippedDuplicates,
        newDownloads,
      });
      console.log(`Skipped ${skippedDuplicates} already-downloaded candidate(s)`);
    }
    if (newDownloads < limit) {
      logger.warn('Ran out of fresh candidates before reaching requested count', {
        requested: limit,
        newDownloads,
        skippedDuplicates,
        poolSize: profileUrls.length,
      });
    }

    await page.close().catch(() => undefined);
    return results;
  } finally {
    await manager.close();
  }
}

async function collectProfileLinks(
  page: Page,
  limit: number,
  shouldSkipName?: (name: string | undefined) => boolean,
): Promise<string[]> {
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  const seenIdentities = new Set<string>();
  let currentPageNo = 1;
  const PAGE_SIZE = 40; // Resdex shows 40 profiles per page
  let skippedKnown = 0;

  while (urls.length < limit) {
    logger.info('Scanning page for profile links', {
      pageNo: currentPageNo,
      collectedSoFar: urls.length,
      limit,
      skippedKnown,
    });

    // Prefer v3/preview links with tupleIndex — one stable link per search card.
    const pageCandidates: {
      url: string;
      tupleIndex: number;
      identity: string;
      name?: string;
    }[] = [];

    for (const selector of PROFILE_LINK_SELECTORS) {
      const links = page.locator(selector);
      const count = await links.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute('href').catch(() => null);
        if (!href) continue;

        const normalized = normalizeUrl(page.url(), href);
        if (
          !normalized ||
          seenUrls.has(normalized) ||
          !looksLikeCandidateUrl(normalized)
        ) {
          continue;
        }

        const identity = candidateIdentityFromUrl(normalized) ?? `url:${normalized}`;
        if (seenIdentities.has(identity)) {
          seenUrls.add(normalized);
          continue;
        }

        let tupleIndex = Number.MAX_SAFE_INTEGER;
        try {
          const raw = new URL(normalized).searchParams.get('tupleIndex');
          if (raw != null && raw !== '') tupleIndex = Number.parseInt(raw, 10);
          if (!Number.isFinite(tupleIndex)) tupleIndex = Number.MAX_SAFE_INTEGER;
        } catch {
          // ignore
        }

        const rawName = (await link.innerText().catch(() => '')).trim();
        const name = rawName.split('\n')[0]?.trim() || undefined;

        seenUrls.add(normalized);
        seenIdentities.add(identity);
        pageCandidates.push({ url: normalized, tupleIndex, identity, name });
      }
    }

    // Keep one URL per identity, ordered by search rank (tupleIndex).
    pageCandidates.sort((a, b) => a.tupleIndex - b.tupleIndex);
    const pageUrls: string[] = [];
    for (const c of pageCandidates.slice(0, PAGE_SIZE)) {
      if (shouldSkipName?.(c.name)) {
        skippedKnown += 1;
        logger.info('Skipping known candidate on results page', {
          name: c.name,
          tupleIndex: c.tupleIndex,
        });
        continue;
      }
      pageUrls.push(c.url);
    }

    urls.push(...pageUrls);

    logger.info('Page scan complete', {
      pageNo: currentPageNo,
      foundOnPage: pageCandidates.length,
      keptOnPage: pageUrls.length,
      totalSoFar: urls.length,
      skippedKnown,
      limit,
    });

    if (urls.length >= limit) {
      break;
    }

    if (pageCandidates.length === 0) {
      logger.warn('No profiles found on search page', { pageNo: currentPageNo });
      break;
    }

    // Need more fresh profiles — go to the next SRP page automatically.
    const moved = await goToNextSearchPage(page, currentPageNo + 1);
    if (!moved) {
      logger.info('No further search pages available', {
        pageNo: currentPageNo,
        collected: urls.length,
      });
      break;
    }
    currentPageNo += 1;
  }

  const collected = urls.slice(0, limit);
  logger.info('Profile links collected', {
    requested: limit,
    found: collected.length,
    skippedKnown,
  });
  if (skippedKnown > 0) {
    console.log(`Naukri: skipped ${skippedKnown} already-downloaded name(s) on results page`);
  }
  return collected;
}

async function goToNextSearchPage(page: Page, nextPageNo: number): Promise<boolean> {
  logger.info('Navigating to next search page', { nextPage: nextPageNo });

  const candidates = [
    page.getByRole('button', { name: /^next$/i }).first(),
    page.getByRole('link', { name: /^next$/i }).first(),
    page.locator('a, button').filter({ hasText: /^›$|^>$|^Next$/i }).first(),
    page.locator('[aria-label*="next" i]').first(),
    page.locator(`a[href*="pageNo=${nextPageNo}"]`).first(),
  ];

  for (const control of candidates) {
    if (!(await control.isVisible({ timeout: 800 }).catch(() => false))) continue;
    if (await control.isDisabled().catch(() => false)) continue;
    await control.click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await delay(600);
    return true;
  }

  // Fallback: rewrite pageNo in the URL.
  try {
    const url = new URL(page.url());
    url.searchParams.set('pageNo', String(nextPageNo));
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await delay(600);
    return new RegExp(`pageNo=${nextPageNo}\\b`, 'i').test(page.url());
  } catch {
    return false;
  }
}


async function saveResdexDebugSnapshot(
  page: Page,
  config: AppConfig,
  label: string,
): Promise<void> {
  const debugDir = path.join(config.sessionDir, 'debug');
  await fs.ensureDir(debugDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '_');

  const links = await page
    .locator('a')
    .evaluateAll((anchors) =>
      anchors.slice(0, 200).map((anchor) => ({
        text: (anchor.textContent || '').trim().slice(0, 160),
        href: anchor.getAttribute('href'),
        className: anchor.getAttribute('class'),
        testId: anchor.getAttribute('data-testid'),
      })),
    )
    .catch(() => []);

  const buttons = await page
    .locator('button,[role="button"]')
    .evaluateAll((nodes) =>
      nodes.slice(0, 200).map((node) => ({
        text: (node.textContent || '').trim().slice(0, 160),
        className: node.getAttribute('class'),
        testId: node.getAttribute('data-testid'),
        ariaLabel: node.getAttribute('aria-label'),
      })),
    )
    .catch(() => []);

  const outPath = path.join(debugDir, `${timestamp}_${safeLabel}.json`);
  await fs.writeJson(
    outPath,
    {
      url: page.url(),
      title: await page.title().catch(() => ''),
      links,
      buttons,
    },
    { spaces: 2 },
  );
  await page
    .screenshot({
      path: path.join(debugDir, `${timestamp}_${safeLabel}.png`),
      fullPage: true,
    })
    .catch(() => undefined);
  logger.warn('Saved Resdex debug snapshot', { outPath });
}

/** Runs only after a local file exists — does not change download behavior. */
async function buildProfileResult(
  config: AppConfig,
  rank: number,
  profileUrl: string,
  candidateName: string | undefined,
  localPath: string | undefined,
): Promise<ResdexResumeDownloadResult> {
  if (!localPath) {
    return {
      rank,
      profileUrl,
      candidateName,
      status: 'clicked',
    };
  }

  if (!isDriveUploadEnabled(config)) {
    return {
      rank,
      profileUrl,
      candidateName,
      localPath,
      status: 'clicked',
    };
  }

  try {
    const driveFile = await uploadLocalResumeToDrive(config, localPath, rank);
    return {
      rank,
      profileUrl,
      candidateName,
      localPath,
      driveFile,
      status: 'uploaded',
    };
  } catch (uploadErr) {
    const message =
      uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    logger.error('Google Drive upload failed (download succeeded)', {
      rank,
      localPath,
      error: message,
    });
    return {
      rank,
      profileUrl,
      candidateName,
      localPath,
      status: 'clicked',
      driveUploadError: message,
    };
  }
}

export async function processProfile(
  context: BrowserContext,
  page: Page,
  config: AppConfig,
  profileUrl: string,
  rank: number,
  isAlreadyDownloaded?: (name: string | undefined) => boolean,
  claimDownloadedName?: (name: string | undefined) => void,
): Promise<ResdexResumeDownloadResult> {
  const downloadDir = path.join(config.sessionDir, 'downloads');
  await fs.ensureDir(downloadDir);
  let candidateName: string | undefined;

  try {
    // Stay on the same automation tab — navigate in-place (no newPage).
    await closeExtraPages(context, page);

    logger.info('Opening candidate profile', { rank, profileUrl });
    const profileWithTab = new URL(profileUrl);
    profileWithTab.searchParams.set('tabKey', 'videoAndCv');

    await page.goto(profileWithTab.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    // ── Captcha check immediately after page load ──────────────────────
    if (await isCaptchaPresent(page)) {
      await waitForCaptchaSolve(page, rank);

      // After solve, re-navigate to the profile (captcha may have redirected)
      await page.goto(profileWithTab.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: config.sessionValidateTimeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    }

    candidateName = await readCandidateName(page);

    // Skip candidates we've already fetched in a previous run or earlier in
    // this run. Naukri preview URLs have no stable id across searches.
    if (isAlreadyDownloaded?.(candidateName)) {
      logger.info('Skipping profile — already downloaded', {
        rank,
        candidateName,
      });
      return {
        rank,
        profileUrl,
        candidateName,
        status: 'skipped',
        skipReason: 'already downloaded (previous run)',
      };
    }

    // Claim before download so a later profile with the same name in this
    // fetch cannot also download (within-run dedup).
    claimDownloadedName?.(candidateName);

    const downloadOutcome = await downloadResume(
      context,
      page,
      config,
      rank,
      candidateName,
      downloadDir,
    );

    const localPath = isManualClickResult(downloadOutcome)
      ? undefined
      : downloadOutcome;

    if (config.manualDownloadSave) {
      if (localPath) {
        logManualSaveResult({ kind: 'saved-to-folder', savedPath: localPath }, rank);
      } else {
        logManualSaveResult({ kind: 'needs-user-action' }, rank);
      }
      await delay(config.manualDownloadPauseMs);
    }

    return await buildProfileResult(
      config,
      rank,
      profileUrl,
      candidateName,
      localPath,
    );
  } catch (error) {

    if (error instanceof Error && error.message === '__captcha__') {
      await waitForCaptchaSolve(page, rank);
    }
    if (error instanceof NoAttachedCvError) {
      logger.info('Skipping profile — no attached CV', {
        rank,
        reason: error.message,
      });
      return {
        rank,
        profileUrl,
        candidateName,
        status: 'skipped',
        skipReason: error.message,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to process candidate profile', {
      rank,
      profileUrl,
      error: message,
    });

    return {
      rank,
      profileUrl,
      status: 'failed',
      error: message,
    };
  } finally {
    // If Download CV opened a PDF popup, close it — keep the main automation tab.
    await closeExtraPages(context, page);
  }
}

async function readCandidateName(page: Page): Promise<string | undefined> {
  for (const selector of CANDIDATE_NAME_SELECTORS) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    const text = await locator.innerText({ timeout: 2000 }).catch(() => '');
    const cleaned = text.trim().split('\n')[0]?.trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

// Profile scraping is currently disabled. To re-enable it, uncomment the helper
// below and restore the profileText/saveProfileScrape logic inside processProfile.
/*
async function scrapeProfilePage(page: Page): Promise<string | undefined> {
  for (const selector of PROFILE_SCRAPE_SELECTORS) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    const text = await locator.innerText({ timeout: 2000 }).catch(() => '');
    const cleaned = text.trim();
    if (cleaned) {
      return cleaned.replace(/\s+/g, ' ').slice(0, 15000);
    }
  }
  return undefined;
}

async function saveProfileScrape(
  page: Page,
  profileUrl: string,
  candidateName: string | undefined,
  profileText: string | undefined,
  downloadDir: string,
  rank: number,
): Promise<void> {
  if (!profileText) return;

  const fileName = `${String(rank).padStart(2, '0')}-${sanitizeFileName(
    candidateName || 'profile',
  )}.json`;
  const filePath = path.join(downloadDir, fileName);
  await fs.writeJson(
    filePath,
    {
      profileUrl,
      pageTitle: await page.title().catch(() => ''),
      candidateName,
      profileText,
    },
    { spaces: 2 },
  );
}
*/

/** Naukri may trigger downloads from a popup or child frame — only context sees every download. */

function collectActiveFrames(page: Page): Frame[] {
  return page.frames().filter((f) => !f.isDetached());
}

async function tryRevealResumeAttachment(page: Page): Promise<boolean> {
  let revealed = false;
  reveal: for (const frame of collectActiveFrames(page)) {
    for (const selector of VIEW_CV_OPEN_SELECTORS) {
      const group = frame.locator(selector);
      const count = await group.count().catch(() => 0);
      const maxIdx = Math.min(count, 6);

      for (let i = 0; i < maxIdx; i++) {
        const control = group.nth(i);
        if (!(await control.isVisible().catch(() => false))) continue;
        try {
          await control.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
          await control.click({ timeout: 10_000 });
          await delay(900);
          await frame
            .page()
            ?.waitForLoadState('networkidle', { timeout: 18_000 })
            .catch(() => undefined);
          logger.info('Clicked View CV / reveal control', { selector, frameUrl: frame.url() });
          revealed = true;
          break reveal;
        } catch {
          // next match
        }
      }
    }
  }
  return revealed;
}

async function downloadResume(
  context: BrowserContext,
  page: Page,
  config: AppConfig,
  rank: number,
  candidateName: string | undefined,
  downloadDir: string,
): Promise<string> {
  const attachedCvAttempt = await downloadViaAttachedCvPage(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
  );
  if (attachedCvAttempt) return attachedCvAttempt;

  await tryRevealResumeAttachment(page);
  await randomDelay(200, 400);

  const fallback = await tryDownloadResumeFromContext(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
    RESUME_DOWNLOAD_SELECTORS,
  );
  if (fallback) return fallback;

  const skipReason = await getSkipReasonIfNoCvOnProfile(page);
  if (skipReason) {
    throw new NoAttachedCvError(skipReason);
  }

  throw new Error(
    config.manualDownloadSave
      ? 'Could not click Download CV on Attached CV. Run with HEADLESS=false and check ATTACHED_CV_* selectors.'
      : 'Could not open Attached CV and download CV. Try HEADLESS=false and check ATTACHED_CV_* selectors.',
  );
}

/** Navigate to Attached CV, then click Download CV inside that panel. */
async function downloadViaAttachedCvPage(
  context: BrowserContext,
  page: Page,
  config: AppConfig,
  downloadDir: string,
  rank: number,
  candidateName?: string,
): Promise<string | null> {
  const opened = await openAttachedCvSection(page);
  if (!opened) {
    const skipReason = await getSkipReasonIfNoCvOnProfile(page);
    if (skipReason) {
      throw new NoAttachedCvError(skipReason);
    }
    logger.debug('Attached CV tab/section not found on profile');
    return null;
  }

  await delay(300);
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);

  await assertAttachedCvAvailable(page);

  const watchDirs = resumeWatchDirs(config, downloadDir);
  const before = await listResumeFilesInDirs(watchDirs);
  const sinceMs = Date.now();

  const fromPanel = await clickDownloadCvInAttachedCvPanel(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
  );
  if (fromPanel) return fromPanel;

  const retryDownload = await tryDownloadResumeFromContext(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
    ATTACHED_CV_DOWNLOAD_SELECTORS,
  );
  if (retryDownload) return retryDownload;

  const claimed = await claimLeakedChromeResume({
    dirs: watchDirs,
    sinceMs,
    before,
    downloadDir,
    rank,
    candidateName,
  });
  if (claimed) return claimed;

  const skipReason = await getSkipReasonIfNoCvOnProfile(page);
  throw new NoAttachedCvError(
    skipReason ?? 'No downloadable CV on Attached CV tab',
  );
}

async function openAttachedCvSection(page: Page): Promise<boolean> {
  for (const frame of collectActiveFrames(page)) {
    try {
      const roleTab = frame.getByRole('tab', { name: /attached\s+cv/i });
      if ((await roleTab.count().catch(() => 0)) > 0) {
        const tab = roleTab.first();
        if (await tab.isVisible().catch(() => false)) {
          await tab.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
          await tab.click({ timeout: 10_000 });
          await frame
            .page()
            ?.waitForLoadState('domcontentloaded', { timeout: 5_000 })
            .catch(() => undefined);

          logger.info('Opened Attached CV tab (role=tab)', { frameUrl: frame.url() });
          return true;
        }
      }
    } catch {
      // fall through to selector list
    }

    for (const selector of ATTACHED_CV_TAB_SELECTORS) {
      const group = frame.locator(selector);
      const count = await group.count().catch(() => 0);
      const maxIdx = Math.min(count, 4);

      for (let i = 0; i < maxIdx; i++) {
        const tab = group.nth(i);
        if (!(await tab.isVisible().catch(() => false))) continue;

        try {
          await tab.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
          await tab.click({ timeout: 10_000 });
          await frame
            .page()
            ?.waitForLoadState('domcontentloaded', { timeout: 5_000 })
            .catch(() => undefined);
          logger.info('Opened Attached CV section', { selector, frameUrl: frame.url() });
          return true;
        } catch {
          // next match
        }
      }
    }
  }
  return false;
}

async function clickDownloadCvInAttachedCvPanel(
  context: BrowserContext,
  page: Page,
  config: AppConfig,
  downloadDir: string,
  rank: number,
  candidateName?: string,
): Promise<string | null> {
  for (const frame of collectActiveFrames(page)) {
    for (const panelSelector of ATTACHED_CV_PANEL_SELECTORS) {
      const panels = frame.locator(panelSelector);
      const panelCount = await panels.count().catch(() => 0);

      for (let p = 0; p < Math.min(panelCount, 2); p++) {
        const panel = panels.nth(p);
        if (!(await panel.isVisible().catch(() => false))) continue;

        try {
          const roleBtn = panel.getByRole('button', { name: /download\s+cv/i });
          if ((await roleBtn.count().catch(() => 0)) > 0) {
            const result = await tryClickDownloadControl(
              context,
              frame,
              roleBtn,
              config,
              downloadDir,
              rank,
              candidateName,
            );
            if (result) {
              logger.info(
                config.manualDownloadSave
                  ? 'Clicked Download CV on Attached CV panel (manual save)'
                  : 'Downloaded via Download CV button on Attached CV panel',
              );
              return result;
            }
            // Click may have leaked into ~/Downloads — stop before overlapping selectors.
            return null;
          }
        } catch {
          // continue with selector list
        }

        for (const downloadSelector of ATTACHED_CV_DOWNLOAD_SELECTORS.slice(0, 3)) {
          const result = await tryClickDownloadControl(
            context,
            frame,
            panel.locator(downloadSelector),
            config,
            downloadDir,
            rank,
            candidateName,
          );
          if (result) {
            logger.info(
              config.manualDownloadSave
                ? 'Clicked download on Attached CV panel (manual save)'
                : 'Downloaded via Attached CV panel',
              { panelSelector, downloadSelector },
            );
            return result;
          }
          // One selector click is enough; outer claim path will recover leaks.
          return null;
        }
      }
    }

    // Frame-level: Download CV visible after Attached CV tab (no panel wrapper found).
    for (const downloadSelector of ATTACHED_CV_DOWNLOAD_SELECTORS.slice(0, 3)) {
      const result = await tryClickDownloadControl(
        context,
        frame,
        frame.locator(downloadSelector),
        config,
        downloadDir,
        rank,
        candidateName,
      );
      if (result) return result;
      return null;
    }
  }

  return null;
}

// async function tryClickDownloadControl (legacy auto-save only) —
//   context: BrowserContext,
//   frame: Frame,
//   group: ReturnType<Frame['locator']>,
//   downloadDir: string,
//   rank: number,
//   candidateName?: string,
// ): Promise<string | null> {
//   const count = await group.count().catch(() => 0);
//   for (let i = 0; i < Math.min(count, 6); i++) {
//     const control = group.nth(i);
//     if (!(await control.isVisible().catch(() => false))) continue;

//     try {
//       await control.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
//       const downloadPromise = context.waitForEvent('download', {
//         timeout: RESUME_DOWNLOAD_TIMEOUT_MS,
//       });
//       await control.click({ timeout: 12_000 });
//       const download = await downloadPromise;
//       const suggested = download.suggestedFilename() || `resume-${rank}.pdf`;
//       const filePath = path.join(
//         downloadDir,
//         buildResumeFileName(rank, candidateName, suggested),
//       );
//       await download.saveAs(filePath);
//       if (!(await isValidResumeFile(filePath))) {
//         await fs.remove(filePath).catch(() => undefined);
//         throw new Error('Downloaded file was not a recognized resume (PDF/DOC/DOCX)');
//       }
//       return filePath;
//     } catch {
//       // next
//     }
//   }
//   return null;
// }

/** Folders where Chrome may drop a CV when Playwright misses the download event. */
function resumeWatchDirs(config: AppConfig, downloadDir: string): string[] {
  const dirs = [
    downloadDir,
    config.localSaveDir,
    path.join(config.sessionDir, 'downloads'),
    path.join(os.homedir(), 'Downloads'),
  ].filter((d): d is string => Boolean(d));
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

async function listResumeFilesInDirs(
  dirs: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const dir of dirs) {
    if (!(await fs.pathExists(dir))) continue;
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      if (!/\.(pdf|docx?)$/i.test(name) || name.startsWith('.') || name.startsWith('~')) {
        continue;
      }
      const full = path.join(dir, name);
      const st = await fs.stat(full).catch(() => null);
      if (!st?.isFile()) continue;
      out.set(full, st.mtimeMs);
    }
  }
  return out;
}

function naukriDownloadBaseName(filePath: string): string {
  return path
    .basename(filePath)
    .replace(/ \(\d+\)(\.[^.]+)$/i, '$1')
    .toLowerCase();
}

/**
 * When Playwright misses the download event, Chrome still saves Naukri_*.pdf
 * (often into ~/Downloads). Claim the newest file from this click and remove
 * same-burst duplicates so we don't keep clicking Download CV.
 */
async function claimLeakedChromeResume(opts: {
  dirs: string[];
  sinceMs: number;
  before: Map<string, number>;
  downloadDir: string;
  rank: number;
  candidateName?: string;
}): Promise<string | null> {
  const after = await listResumeFilesInDirs(opts.dirs);
  const newcomers: { file: string; mtime: number }[] = [];

  for (const [file, mtime] of after) {
    if (mtime + 50 < opts.sinceMs - 2_000) continue;
    const prev = opts.before.get(file);
    if (prev !== undefined && mtime <= prev) continue;
    newcomers.push({ file, mtime });
  }

  if (newcomers.length === 0) return null;

  newcomers.sort((a, b) => b.mtime - a.mtime);
  const naukriFirst = newcomers.filter((n) =>
    /^naukri_/i.test(path.basename(n.file)),
  );
  const pick = naukriFirst[0] ?? newcomers[0];
  if (!pick || !(await isValidResumeFile(pick.file))) return null;

  await fs.ensureDir(opts.downloadDir);
  const dest = path.join(
    opts.downloadDir,
    buildResumeFileName(opts.rank, opts.candidateName, path.basename(pick.file)),
  );

  if (path.resolve(pick.file) !== path.resolve(dest)) {
    await fs.move(pick.file, dest, { overwrite: true });
  }

  const base = naukriDownloadBaseName(pick.file);
  for (const n of newcomers) {
    if (path.resolve(n.file) === path.resolve(pick.file)) continue;
    if (path.resolve(n.file) === path.resolve(dest)) continue;
    if (naukriDownloadBaseName(n.file) !== base) continue;
    await fs.remove(n.file).catch(() => undefined);
  }

  logger.info('Claimed CV Chrome saved outside Playwright capture', {
    from: pick.file,
    to: dest,
    burstDuplicatesRemoved: newcomers.length - 1,
  });
  return dest;
}

async function savePlaywrightDownload(
  download: Download,
  downloadDir: string,
  rank: number,
  candidateName?: string,
): Promise<string> {
  const suggested = download.suggestedFilename() || `resume-${rank}.pdf`;
  const filePath = path.join(
    downloadDir,
    buildResumeFileName(rank, candidateName, suggested),
  );
  await fs.ensureDir(downloadDir);
  await download.saveAs(filePath);
  if (!(await isValidResumeFile(filePath))) {
    await fs.remove(filePath).catch(() => undefined);
    throw new Error('Downloaded file was not a recognized resume (PDF/DOC/DOCX)');
  }
  return filePath;
}

async function tryClickDownloadControl(
  context: BrowserContext,
  frame: Frame,
  group: ReturnType<Frame['locator']>,
  config: AppConfig,
  downloadDir: string,
  rank: number,
  candidateName?: string,
): Promise<string | null> {
  const count = await group.count().catch(() => 0);
  // One visible control is enough — retrying overlapping selectors was clicking
  // Download CV repeatedly and dumping Naukri_*.pdf into ~/Downloads.
  for (let i = 0; i < Math.min(count, 2); i++) {
    const control = group.nth(i);
    if (!(await control.isVisible().catch(() => false))) continue;

    try {
      await control.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);

      if (config.manualDownloadSave) {
        const mainPage = frame.page();
        if (!mainPage) continue;

        const { download: downloadWait, newPage: newPageWait } =
          watchAfterDownloadClick(context, mainPage);

        await moveMouseNaturally(mainPage, control);
        await control.click({ timeout: 12_000 });

        const [download, newPage] = await Promise.all([downloadWait, newPageWait]);

        if (download && config.localSaveDir) {
          await fs.ensureDir(config.localSaveDir);
          const suggested = download.suggestedFilename() || `resume-${rank}.pdf`;
          const filePath = path.join(
            config.localSaveDir,
            buildResumeFileName(rank, candidateName, suggested),
          );
          await download.saveAs(filePath);
          if (await isValidResumeFile(filePath)) {
            logger.info('Manual mode: CV captured to folder', { filePath, rank });
            return filePath;
          }
          await fs.remove(filePath).catch(() => undefined);
        }

        if (newPage) {
          await newPage.bringToFront();
          logger.info('Manual mode: CV opened in new tab', { url: newPage.url(), rank });
        } else {
          logger.info('Manual mode: Download CV clicked', { rank, frameUrl: frame.url() });
        }

        return MANUAL_CLICK_SENTINEL;
      }

      const watchDirs = resumeWatchDirs(config, downloadDir);
      const before = await listResumeFilesInDirs(watchDirs);
      const sinceMs = Date.now();
      const waitMs = Math.min(20_000, RESUME_DOWNLOAD_TIMEOUT_MS);

      const captured: { download: Download | null; page: Page | null } = {
        download: null,
        page: null,
      };
      const downloadWait = context
        .waitForEvent('download', { timeout: waitMs })
        .then((d) => {
          captured.download = d;
          return d;
        })
        .catch(() => null);
      const pageWait = context
        .waitForEvent('page', { timeout: waitMs })
        .then((p) => {
          captured.page = p;
          return p;
        })
        .catch(() => null);

      await control.click({ timeout: 12_000 });

      // Poll for Playwright download, new tab, OR a file Chrome already wrote.
      // Do not Promise.race timeout-null (that used to win at 10s and click again).
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        if (captured.download) {
          await Promise.allSettled([downloadWait, pageWait]);
          return savePlaywrightDownload(
            captured.download,
            downloadDir,
            rank,
            candidateName,
          );
        }
        if (captured.page) {
          const openedPage = captured.page;
          await Promise.allSettled([downloadWait, pageWait]);
          await openedPage
            .waitForLoadState('domcontentloaded', { timeout: 15_000 })
            .catch(() => undefined);
          const pdfUrl = openedPage.url();
          logger.info('CV opened in new tab', { pdfUrl });

          const tabDownload = await openedPage
            .waitForEvent('download', { timeout: 8_000 })
            .catch(() => null);
          if (tabDownload) {
            const filePath = await savePlaywrightDownload(
              tabDownload,
              downloadDir,
              rank,
              candidateName,
            );
            await openedPage.close().catch(() => undefined);
            return filePath;
          }

          const cookies = await context.cookies();
          const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
          await openedPage.close().catch(() => undefined);

          if (!pdfUrl || pdfUrl === 'about:blank') {
            throw new Error('New tab opened but URL was blank');
          }

          const response = await fetch(pdfUrl, {
            headers: {
              Cookie: cookieHeader,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch CV from new tab URL: ${response.status}`);
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const filePath = path.join(
            downloadDir,
            buildResumeFileName(rank, candidateName, 'resume.pdf'),
          );
          await fs.writeFile(filePath, buffer);
          if (!(await isValidResumeFile(filePath))) {
            await fs.remove(filePath).catch(() => undefined);
            throw new Error('Fetched file from new tab URL was not a recognized resume');
          }
          logger.info('CV saved via new-tab URL fetch', { filePath });
          return filePath;
        }

        const claimed = await claimLeakedChromeResume({
          dirs: watchDirs,
          sinceMs,
          before,
          downloadDir,
          rank,
          candidateName,
        });
        if (claimed) return claimed;

        await delay(250);
      }

      await Promise.allSettled([downloadWait, pageWait]);
      const claimedLate = await claimLeakedChromeResume({
        dirs: watchDirs,
        sinceMs,
        before,
        downloadDir,
        rank,
        candidateName,
      });
      if (claimedLate) return claimedLate;

      logger.debug('No download or new page after click, trying next control');
    } catch (err) {
      logger.debug('tryClickDownloadControl attempt failed', {
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
      // next
    }
  }
  return null;
}
async function randomIdleBehavior(page: Page): Promise<void> {
  if (Math.random() > 0.3) return; // Only 30% of the time

  // Random scroll up and down
  const scrolls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, (Math.random() - 0.5) * 600);
    await delay(300 + Math.random() * 700);
  }
}
async function tryDownloadResumeFromContext(
  context: BrowserContext,
  page: Page,
  config: AppConfig,
  downloadDir: string,
  rank: number,
  candidateName: string | undefined,
  selectors: readonly string[],
): Promise<string | null> {
  for (const frame of collectActiveFrames(page)) {
    for (const selector of selectors) {
      const result = await tryClickDownloadControl(
        context,
        frame,
        frame.locator(selector),
        config,
        downloadDir,
        rank,
        candidateName,
      );
      if (result) return result;
    }
  }
  return null;
}

async function isValidResumeFile(filePath: string): Promise<boolean> {
  const buffer = await fs.readFile(filePath).catch(() => null);
  if (!buffer || buffer.length < 8) return false;

  const sig4 = buffer.slice(0, 4).toString('latin1');
  if (sig4 === '%PDF') return true;

  // ZIP-based Office (.docx) — PK\x03\x04 or empty zip variants
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (
      (buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08)
    ) {
      return true;
    }
  }

  // Legacy MS Word .doc (OLE compound document)
  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return true;
  }

  return false;
}

function assertResdexAccessible(page: Page, config: AppConfig): void {
  const url = page.url();
  if (/recruit\/login|RPAuthenticate/i.test(url)) {
    if (config.manualResdexLogin) return;
    throw new Error(
      'Naukri login required — sign in via npm run login-naukri, then retry the fetch.',
    );
  }
}

async function waitForResdexAccess(page: Page, config: AppConfig): Promise<void> {
  assertResdexAccessible(page, config);
  if (!/recruit\/login|RPAuthenticate/i.test(page.url())) return;

  logger.info('Waiting for Naukri login in Chrome — sign in to continue');
  console.log('\n=== Naukri login ===');
  console.log('Sign in in the Chrome window. Downloads will continue automatically.\n');

  const deadline = Date.now() + config.loginTimeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/resdex\.naukri\.com/i.test(url) && !/recruit\/login|RPAuthenticate/i.test(url)) {
      logger.info('Naukri login detected — continuing Resdex download');
      return;
    }
    await delay(1000);
  }

  throw new Error(
    `Naukri login timed out after ${config.loginTimeoutMs / 1000}s. Run: npm run login-naukri`,
  );
}

function normalizeUrl(baseUrl: string, href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/** Stable-enough identity for deduping links on a single search results page. */
function candidateIdentityFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const uniqId = parsed.searchParams.get('uniqId')?.trim();
    if (uniqId) return `uniq:${uniqId}`;
    const uresid = parsed.searchParams.get('uresid')?.trim();
    if (uresid) return `ures:${uresid}`;
    const tupleIndex = parsed.searchParams.get('tupleIndex')?.trim();
    const sid = parsed.searchParams.get('sid')?.trim() || parsed.searchParams.get('parentSid')?.trim();
    if (tupleIndex !== null && tupleIndex !== undefined && sid) {
      return `tuple:${sid}:${tupleIndex}`;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function looksLikeCandidateUrl(url: string): boolean {
  if (!/resdex\.naukri\.com/i.test(url)) return false;
  if (/resume-database-access-resdex/i.test(url)) return false;
  if (/\/recruit\/login/i.test(url)) return false;
  if (/\/recruit\/?$/i.test(url)) return false;
  if (/\/v2\/(ResetLogin|ChangeLogin)/i.test(url)) return false;
  if (/\/v3\/?(?:\?.*)?$/i.test(url)) return false;
  if (/\/v3\/(?:search\/savedSearches|folder\/list|hiringFor\/list|report\/usage)/i.test(url)) {
    return false;
  }
  if (/\/quota\/manage/i.test(url)) return false;

  return /candidate|profile|resumeId|profileId|resId|candId|preview|mnjuser/i.test(
    url,
  );
}

function buildResumeFileName(
  rank: number,
  candidateName: string | undefined,
  suggestedFileName: string,
): string {
  const ext = path.extname(suggestedFileName) || '.pdf';
  const base = path.basename(suggestedFileName, path.extname(suggestedFileName));
  const label = candidateName || base || 'candidate';
  return `${String(rank).padStart(2, '0')}-${sanitizeFileName(label)}${ext}`;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/\s/g, '-');
}
