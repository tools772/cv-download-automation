import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext, Frame, Page } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { createSessionManager } from '../session/manager.js';
import { createPage } from '../browser/launcher.js';
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
import { printProfileStatus } from '../utils/runOutput.js';
import { delay, randomDelay } from '../utils/delay.js';
import { logger } from '../utils/logger.js';

/** Returned when we only click Download CV and let the browser handle Save As. */
export const MANUAL_CLICK_SENTINEL = '__manual_download_click__';

export function isManualClickResult(value: string): boolean {
  return value === MANUAL_CLICK_SENTINEL;
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
  'text=/^\\s*Download\\s+CV\\s*$/i',
  'button:has-text("Download attached CV")',
  '[role="button"]:has-text("Download attached CV")',
  'a:has-text("Download attached CV")',
  'button:has-text("Download Resume")',
  '[role="button"]:has-text("Download Resume")',
  'a[download]',
  'a[href*="download" i]',
  // Icon/SVG buttons (no visible text)
  'button[aria-label*="download" i]',
  'button[aria-label*="Download" i]',
  '[role="button"][aria-label*="download" i]',
  '[title*="download" i]',
  '[class*="downloadIcon"]',
  '[class*="download-icon"]',
  '[class*="downloadBtn"]',
  '[class*="download-btn"]',
  '[class*="cvDownload"]',
  '[class*="cv-download"]',
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

/**
 * Detects and handles the Resdex "Someone is already logged in" subuser conflict page.
 * Clicks "Reset Subuser" tab → "Reset & Login" button automatically.
 * Returns true if conflict was detected and handled, false if no conflict page.
 */
async function handleSubuserConflict(page: Page): Promise<boolean> {
  // Check if we're on the conflict page by looking for the key text
  const conflictText = await page
    .locator('text=/Someone is already logged into Resdex/i')
    .first()
    .isVisible()
    .catch(() => false);

  if (!conflictText) return false; // No conflict, nothing to do

  logger.info('Subuser conflict page detected — attempting auto-reset');
  logger.warn('Subuser conflict detected — auto-resetting');

  try {
    // Step 1: Click "Reset Subuser" tab
    const resetTab = page
      .locator('[role="tab"]:has-text("Reset Subuser"), button:has-text("Reset Subuser"), a:has-text("Reset Subuser")')
      .first();

    const tabVisible = await resetTab.isVisible().catch(() => false);
    if (!tabVisible) {
      logger.warn('Reset Subuser tab not found');
      return false;
    }

    await resetTab.click({ timeout: 8_000 });
    await delay(1_000);
    logger.info('Clicked Reset Subuser tab');

    // Step 2: Click "Reset & Login" button
    const resetBtn = page
      .locator('button:has-text("Reset & Login"), [role="button"]:has-text("Reset & Login"), input[value="Reset & Login"]')
      .first();

    const btnVisible = await resetBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!btnVisible) {
      logger.warn('Reset & Login button not found after clicking tab');
      return false;
    }

    await resetBtn.click({ timeout: 8_000 });
    logger.info('Clicked Reset & Login');

    // Step 3: Wait for redirect away from conflict/login page
    await page.waitForURL(
      (url) => !url.toString().includes('login') && !url.toString().includes('conflict'),
      { timeout: 15_000 }
    ).catch(() => undefined);

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const finalUrl = page.url();
    logger.info('Post-reset URL', { url: finalUrl });

    if (finalUrl.includes('login')) {
      logger.warn('Still on login page after subuser reset');
      return false;
    }

    logger.info('Subuser conflict resolved');
    return true;

  } catch (err) {
    logger.error('Failed to handle subuser conflict', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
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

    logger.info('Opening Resdex saved search/folder', {
      url: config.resdexSavedSearchUrl,
      downloadLimit: config.downloadLimit,
      limit,
    });

    await page.goto(config.resdexSavedSearchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.sessionValidateTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

    // ── Handle subuser conflict if present ──────────────────────────────────
    const conflictFound = await handleSubuserConflict(page);
    if (conflictFound) {
      // After reset, navigate back to the saved search URL
      logger.info('Re-navigating to saved search after subuser reset');
      await page.goto(config.resdexSavedSearchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.sessionValidateTimeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }

    const profileUrls = await collectProfileLinks(page, limit);
    
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
      remaining: profileUrls.length - startIndex,
    });
    
    const results: ResdexResumeDownloadResult[] = [];
    for (let i = startIndex; i < profileUrls.length; i++) {
      const rank = i + 1;
      const result = await processProfile(context, config, profileUrls[i]!, rank);
      results.push(result);
      printProfileStatus(result);
    
      // Preventive break every 20 downloads
      const downloaded = i - startIndex + 1;
      if (downloaded % 20 === 0 && i + 1 < profileUrls.length) {
        logger.info('Preventive break after batch of downloads', { downloaded });
        await delay(120_000);
      } else {
        await humanPause(i + 1); // human pause
        // await randomDelay(400, 900);
      }
    }


    await page.close().catch(() => undefined);
    return results;
  } finally {
    await manager.close();
  }
}

// async function collectProfileLinks(page: Page, limit: number): Promise<string[]> {
//   const urls: string[] = [];
//   const seen = new Set<string>();

//   const maxScrolls = Math.max(8, Math.ceil(limit / 3));
//   for (let scroll = 0; scroll < maxScrolls && urls.length < limit; scroll++) {
//     for (const selector of PROFILE_LINK_SELECTORS) {
//       const links = page.locator(selector);
//       const count = Math.min(await links.count().catch(() => 0), limit * 8);

//       for (let i = 0; i < count && urls.length < limit; i++) {
//         const href = await links.nth(i).getAttribute('href').catch(() => null);
//         if (!href) continue;

//         const normalized = normalizeUrl(page.url(), href);
//         if (!normalized || seen.has(normalized) || !looksLikeCandidateUrl(normalized)) {
//           continue;
//         }

//         seen.add(normalized);
//         urls.push(normalized);
//       }
//     }

//     if (urls.length >= limit) break;
//     await page.mouse.wheel(0, 2500).catch(() => undefined);
//     await delay(500);
//   }

//   const collected = urls.slice(0, limit);
//   logger.info('Profile links collected', { requested: limit, found: collected.length });
//   return collected;
// }

async function collectProfileLinks(page: Page, limit: number): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  let currentPageNo = 1;
  const PAGE_SIZE = 40; // Resdex shows 40 profiles per page

  while (urls.length < limit) {
    logger.info('Scanning page for profile links', {
      pageNo: currentPageNo,
      collectedSoFar: urls.length,
      limit,
    });

    // ── Collect links visible on THIS page only (no aggressive scrolling) ──
    const pageUrls: string[] = [];

    for (const selector of PROFILE_LINK_SELECTORS) {
      const links = page.locator(selector);
      const count = await links.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const href = await links.nth(i).getAttribute('href').catch(() => null);
        if (!href) continue;

        const normalized = normalizeUrl(page.url(), href);
        if (
          !normalized ||
          seen.has(normalized) ||
          !looksLikeCandidateUrl(normalized)
        ) continue;

        seen.add(normalized);
        pageUrls.push(normalized);

        // Stop collecting once we hit PAGE_SIZE for this page
        if (pageUrls.length >= PAGE_SIZE) break;
      }

      if (pageUrls.length >= PAGE_SIZE) break;
    }

    urls.push(...pageUrls);

    logger.info('Page scan complete', {
      pageNo: currentPageNo,
      foundOnPage: pageUrls.length,
      totalSoFar: urls.length,
      limit,
    });

    // ── Done if limit reached ──────────────────────────────────────────────
    if (urls.length >= limit) {
      break;
    }

    // ── No profiles found on this page — something is wrong ───────────────
    if (pageUrls.length === 0) {
      logger.warn('No profiles found on search page', { pageNo: currentPageNo });
      break;
    }

    // ── Still need more — wait for user to go to next page ─────────────────
    logger.info('Waiting for next search page', { nextPage: currentPageNo + 1 });

    await delay(5_000);

    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await delay(500);

    currentPageNo++;
  }

  const collected = urls.slice(0, limit);
  logger.info('Profile links collected', { requested: limit, found: collected.length });
  return collected;
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
  config: AppConfig,
  profileUrl: string,
  rank: number,
): Promise<ResdexResumeDownloadResult> {
  const page = await createPage(context);
  const downloadDir = path.join(config.sessionDir, 'downloads');
  await fs.ensureDir(downloadDir);
  let candidateName: string | undefined;

  try {
    logger.info('Opening candidate profile', { rank, profileUrl });
    // await page.goto(profileUrl, {
    //   waitUntil: 'domcontentloaded',
    //   timeout: config.sessionValidateTimeoutMs,
    // });
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
      // await waitForUserToContinue(rank, candidateName);
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
    await page.close().catch(() => undefined);
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

  const fromPanel = await clickDownloadCvInAttachedCvPanel(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
  );
  if (fromPanel) return fromPanel;

  return tryDownloadResumeFromContext(
    context,
    page,
    config,
    downloadDir,
    rank,
    candidateName,
    ATTACHED_CV_DOWNLOAD_SELECTORS,
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

      for (let p = 0; p < Math.min(panelCount, 3); p++) {
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
          }
        } catch {
          // continue with selector list
        }

        for (const downloadSelector of ATTACHED_CV_DOWNLOAD_SELECTORS) {
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
        }
      }
    }

    // Frame-level: Download CV visible after Attached CV tab (no panel wrapper found).
    for (const downloadSelector of ATTACHED_CV_DOWNLOAD_SELECTORS) {
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
  for (let i = 0; i < Math.min(count, 6); i++) {
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

      // Race: Naukri may trigger a download event OR open a new tab with the PDF
      const downloadPromise = context.waitForEvent('download', {
        timeout: RESUME_DOWNLOAD_TIMEOUT_MS,
      }).catch(() => null);

      const newPagePromise = context.waitForEvent('page', {
        timeout: 10_000,
      }).catch(() => null);

      await control.click({ timeout: 12_000 });

      // Wait for whichever fires first
      const result = await Promise.race([
        downloadPromise.then((d) => d ? ({ type: 'download' as const, value: d }) : null),
        newPagePromise.then((p) => p ? ({ type: 'page' as const, value: p }) : null),
      ]);

      if (!result) {
        logger.debug('No download or new page after click, trying next selector');
        continue;
      }

      // --- Path A: direct browser download ---
      if (result.type === 'download') {
        const download = result.value;
        const suggested = download.suggestedFilename() || `resume-${rank}.pdf`;
        const filePath = path.join(
          downloadDir,
          buildResumeFileName(rank, candidateName, suggested),
        );
        await download.saveAs(filePath);
        if (!(await isValidResumeFile(filePath))) {
          await fs.remove(filePath).catch(() => undefined);
          throw new Error('Downloaded file was not a recognized resume (PDF/DOC/DOCX)');
        }
        return filePath;
      }

      // --- Path B: CV opened in a new tab (PDF viewer) ---
      if (result.type === 'page') {
        const newPage = result.value;
        await newPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
        const pdfUrl = newPage.url();
        logger.info('CV opened in new tab', { pdfUrl });

        // Try triggering a download from within the new tab first
        const tabDownload = await newPage.waitForEvent('download', { timeout: 8_000 }).catch(() => null);
        if (tabDownload) {
          const suggested = tabDownload.suggestedFilename() || `resume-${rank}.pdf`;
          const filePath = path.join(
            downloadDir,
            buildResumeFileName(rank, candidateName, suggested),
          );
          await tabDownload.saveAs(filePath);
          await newPage.close().catch(() => undefined);
          if (!(await isValidResumeFile(filePath))) {
            await fs.remove(filePath).catch(() => undefined);
            throw new Error('Downloaded file from new tab was not a recognized resume');
          }
          return filePath;
        }

        // Fallback: fetch the PDF URL directly using session cookies
        const cookies = await context.cookies();
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        await newPage.close().catch(() => undefined);

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

function normalizeUrl(baseUrl: string, href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
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
