import path from 'node:path';
import fs from 'fs-extra';
import type { Page } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import { CANDIDATE_PROFILE } from './selectors.js';
import { dismissPromotionalModals } from './dismissPopups.js';
import { waitForCandidateListReady } from './waitForCandidateList.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

async function clickFirstVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await el.click({ timeout: 12_000 });
    return true;
  }
  return false;
}

async function waitForProfilePanel(page: Page): Promise<void> {
  const downloadLink = page.getByRole('link', { name: /Download resume/i }).first();
  const downloadText = page.getByText(/^Download resume$/i).first();
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (await downloadLink.isVisible().catch(() => false)) return;
    if (await downloadText.isVisible().catch(() => false)) return;
    if (await page.getByRole('tab', { name: /^Resume$/i }).isVisible().catch(() => false)) {
      return;
    }
    await delay(400);
  }

  throw new Error('Candidate profile panel did not open (expected "Download resume" link).');
}

async function closeProfilePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await delay(400);

  if (await page.getByText(/^Download resume$/i).first().isVisible().catch(() => false)) {
    if (await clickFirstVisible(page, CANDIDATE_PROFILE.close)) {
      await delay(400);
    } else {
      await page.keyboard.press('Escape').catch(() => undefined);
      await delay(400);
    }
  }

  await dismissPromotionalModals(page);
}

/**
 * Download resumes by opening each candidate's profile (View profile → Download resume).
 * Matches the Instahyre employer UI when bulk "Download resumes" zip modal is unavailable.
 */
export async function downloadProfilesOnPage(
  page: Page,
  config: InstahyreConfig,
  pageNumber: number,
  count: number,
): Promise<{ dir: string; files: string[] }> {
  const batchDir = path.join(
    config.localSaveDir,
    `instahyre-page-${String(pageNumber).padStart(2, '0')}-profiles`,
  );
  await fs.ensureDir(batchDir);

  const savedFiles: string[] = [];
  const viewProfileLinks = page.locator('a, button, [role="button"]').filter({
    hasText: /^View profile$/i,
  });
  const available = await viewProfileLinks.count();
  if (available === 0) {
    throw new Error(
      'No "View profile" controls on this page — the candidate list may still be loading, or the URL may not be a job Candidates tab.',
    );
  }

  const toDownload = Math.min(count, available);
  logger.info('Downloading via View profile → Download resume', {
    pageNumber,
    toDownload,
    availableOnPage: available,
  });

  for (let i = 0; i < toDownload; i++) {
    await dismissPromotionalModals(page);
    await waitForCandidateListReady(page, config.sessionValidateTimeoutMs);

    const viewProfile = viewProfileLinks.nth(i);
    await viewProfile.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await viewProfile.click({ timeout: 12_000 });
    await waitForProfilePanel(page);
    await delay(300);

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });

    const downloadLink = page.getByRole('link', { name: /Download resume/i }).first();
    if (await downloadLink.isVisible().catch(() => false)) {
      await downloadLink.click({ timeout: 10_000 });
    } else if (!(await clickFirstVisible(page, CANDIDATE_PROFILE.downloadResume))) {
      throw new Error(`Could not find "Download resume" in profile panel (candidate ${i + 1}).`);
    }

    const download = await downloadPromise;
    const suggested = download.suggestedFilename() || `candidate-${i + 1}.pdf`;
    const fileName = `${String(i + 1).padStart(2, '0')}-${suggested.replace(/[^\w.-]+/g, '_')}`;
    const localPath = path.join(batchDir, fileName);
    await download.saveAs(localPath);
    savedFiles.push(localPath);

    logger.info('Profile resume downloaded', { pageNumber, index: i + 1, localPath });
    console.log(`[page ${pageNumber}] profile ${i + 1}/${toDownload} → ${fileName}`);

    await closeProfilePanel(page);
    await delay(500);
  }

  return { dir: batchDir, files: savedFiles };
}
