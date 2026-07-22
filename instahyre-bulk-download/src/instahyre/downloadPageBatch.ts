import path from 'node:path';
import type { Locator, Page } from 'playwright';
import type { InstahyreConfig } from '../types/index.js';
import { CANDIDATE_LIST, DOWNLOAD_MODAL } from './selectors.js';
import { dismissPromotionalModals } from './dismissPopups.js';
import { INSTAHYRE_PAGE_SIZE, prepareForPagination } from './pagination.js';
import { waitForCandidateListReady } from './waitForCandidateList.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';
import { downloadProfilesOnPage } from './downloadProfileResume.js';

export interface PageBatchResult {
  pageNumber: number;
  resumeCount: number;
  localPath: string;
  status: 'downloaded' | 'failed';
  error?: string;
  extractedDir?: string;
  uploadedToDrive?: number;
  driveUploadFailed?: number;
}

async function clickFirst(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await el.click({ timeout: 10_000 });
    return true;
  }
  return false;
}

async function checkFirst(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await el.check({ timeout: 10_000 }).catch(async () => {
      await el.click({ timeout: 10_000 });
    });
    return true;
  }
  return false;
}

function parseResumeCountFromModal(page: Page): Promise<number> {
  return page
    .locator('text=/Download\\s+(\\d+)\\s+resumes?/i')
    .first()
    .innerText()
    .then((text) => {
      const match = text.match(/Download\s+(\d+)\s+resumes?/i);
      return match ? Number.parseInt(match[1]!, 10) : 30;
    })
    .catch(() => 30);
}

export async function parseResultsTotal(page: Page): Promise<number | null> {
  const body = await page.locator('body').innerText().catch(() => '');
  const match = body.match(CANDIDATE_LIST.resultsSummary);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function isExcludedCheckboxLabel(labelText: string): boolean {
  return /select all|zip file of resumes/i.test(labelText);
}

function isPageClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /target page, context or browser has been closed/i.test(message);
}

function assertPageOpen(page: Page, step: string): void {
  if (page.isClosed()) {
    throw new Error(
      `Browser tab closed during ${step}. ` +
        'If a Chrome window opened, leave it open until the download finishes. ' +
        'For unattended runs, set HEADLESS=true or FETCH_CVS_HEADLESS=true in .env.local.',
    );
  }
}

async function getProfileCheckboxLocators(page: Page): Promise<Locator[]> {
  assertPageOpen(page, 'candidate checkbox lookup');

  for (const selector of CANDIDATE_LIST.profileCheckbox) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) continue;

    const visible: Locator[] = [];
    for (let i = 0; i < count; i++) {
      assertPageOpen(page, 'candidate checkbox lookup');
      const checkbox = locator.nth(i);
      if (!(await checkbox.isVisible().catch(() => false))) continue;
      visible.push(checkbox);
    }
    if (visible.length > 0) return visible;
  }

  const indices = await page
    .evaluate((excludePattern) => {
      const exclude = new RegExp(excludePattern, 'i');
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const result: number[] = [];
      boxes.forEach((el, index) => {
        const input = el as HTMLInputElement;
        if (!input.offsetParent) return;
        const label = input.closest('label')?.textContent?.trim() ?? '';
        const inDialog = Boolean(
          input.closest('[role="dialog"], .modal, [class*="modal"]'),
        );
        if (inDialog || exclude.test(label)) return;
        result.push(index);
      });
      return result;
    }, 'select all|zip file of resumes')
    .catch((error) => {
      if (isPageClosedError(error)) {
        throw new Error(
          'Browser tab closed while scanning candidate checkboxes. ' +
            'Leave the automation window open, or use HEADLESS=true for background runs.',
        );
      }
      return null;
    });

  if (indices && indices.length > 0) {
    const allCheckboxes = page.locator('input[type="checkbox"]');
    return indices.map((index) => allCheckboxes.nth(index));
  }

  const allCheckboxes = page.locator('input[type="checkbox"]');
  const count = await allCheckboxes.count();
  const profileCheckboxes: Locator[] = [];

  for (let i = 0; i < count; i++) {
    assertPageOpen(page, 'candidate checkbox lookup');
    const checkbox = allCheckboxes.nth(i);
    if (!(await checkbox.isVisible().catch(() => false))) continue;

    const meta = await checkbox
      .evaluate((el) => {
        const label = el.closest('label')?.textContent?.trim() ?? '';
        const inDialog = Boolean(el.closest('[role="dialog"], .modal, [class*="modal"]'));
        return { label, inDialog };
      })
      .catch((error) => {
        if (isPageClosedError(error)) {
          throw new Error(
            'Browser tab closed while reading candidate checkboxes. ' +
              'Leave the automation window open, or use HEADLESS=true for background runs.',
          );
        }
        return { label: 'unknown', inDialog: true };
      });

    if (meta.inDialog || isExcludedCheckboxLabel(meta.label)) continue;
    profileCheckboxes.push(checkbox);
  }

  return profileCheckboxes;
}

async function selectAllCandidates(page: Page): Promise<void> {
  if (await checkFirst(page, CANDIDATE_LIST.selectAll)) return;

  for (const pattern of [/Select all/i, /Select All/i]) {
    const selectAllLabel = page.getByText(pattern).first();
    if (await selectAllLabel.isVisible().catch(() => false)) {
      await selectAllLabel.click();
      return;
    }
  }

  throw new Error('Could not find "Select all" checkbox');
}

async function clearProfileSelection(page: Page): Promise<void> {
  for (const checkbox of await getProfileCheckboxLocators(page)) {
    if (!(await checkbox.isChecked().catch(() => false))) continue;
    await checkbox.uncheck({ timeout: 5000 }).catch(async () => {
      await checkbox.click({ timeout: 5000 }).catch(() => undefined);
    });
  }
}

async function selectPartialCandidates(page: Page, count: number): Promise<number> {
  await selectAllCandidates(page);
  await delay(300);

  const profileCheckboxes = await getProfileCheckboxLocators(page);
  if (profileCheckboxes.length === 0) {
    throw new Error('Could not find candidate checkboxes on this page');
  }

  const checked: Locator[] = [];
  for (const checkbox of profileCheckboxes) {
    if (await checkbox.isChecked().catch(() => false)) {
      checked.push(checkbox);
    }
  }

  if (checked.length === 0) {
    return await selectIndividualCandidates(page, count);
  }

  let toUncheck = checked.length - count;
  for (let i = checked.length - 1; i >= 0 && toUncheck > 0; i--) {
    const checkbox = checked[i]!;
    await checkbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await checkbox.uncheck({ timeout: 8000 }).catch(async () => {
      await checkbox.click({ timeout: 8000 });
    });
    if (!(await checkbox.isChecked().catch(() => true))) {
      toUncheck--;
    }
  }

  let selected = 0;
  for (const checkbox of profileCheckboxes) {
    if (await checkbox.isChecked().catch(() => false)) {
      selected++;
    }
  }

  if (selected < count) {
    logger.warn('Select-all trim left fewer candidates than requested; topping up individually', {
      requested: count,
      selected,
    });
    return await selectIndividualCandidates(page, count);
  }

  return Math.min(selected, count);
}

async function selectIndividualCandidates(page: Page, count: number): Promise<number> {
  await clearProfileSelection(page);

  const profileCheckboxes = await getProfileCheckboxLocators(page);
  if (profileCheckboxes.length === 0) {
    throw new Error('Could not find candidate checkboxes on this page');
  }

  const toSelect = Math.min(count, profileCheckboxes.length);
  let selected = 0;

  for (let i = 0; i < profileCheckboxes.length && selected < toSelect; i++) {
    const checkbox = profileCheckboxes[i]!;

    await checkbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await checkbox.check({ timeout: 8000 }).catch(async () => {
      await checkbox.click({ timeout: 8000 });
    });

    if (await checkbox.isChecked().catch(() => false)) {
      selected++;
      await delay(150);
    }
  }

  if (selected < toSelect) {
    throw new Error(`Could only select ${selected} of ${toSelect} candidates on this page`);
  }

  return toSelect;
}

async function selectCandidatesForBatch(page: Page, selectCount: number): Promise<number> {
  await prepareForPagination(page);

  if (selectCount >= INSTAHYRE_PAGE_SIZE) {
    try {
      await selectAllCandidates(page);
      return INSTAHYRE_PAGE_SIZE;
    } catch (error) {
      logger.warn('Select all failed; falling back to individual checkboxes', {
        error: error instanceof Error ? error.message : String(error),
      });
      return await selectIndividualCandidates(page, selectCount);
    }
  }

  try {
    const selected = await selectPartialCandidates(page, selectCount);
    logger.info('Selected candidates for partial page download', {
      requested: selectCount,
      selected,
    });
    return selected;
  } catch (error) {
    logger.warn('Select-all trim failed; falling back to individual checkboxes', {
      error: error instanceof Error ? error.message : String(error),
    });
    const selected = await selectIndividualCandidates(page, selectCount);
    logger.info('Selected individual candidates for partial page download', {
      requested: selectCount,
      selected,
    });
    return selected;
  }
}

/** Download resumes for the current page (View profile → Download resume, with bulk zip fallback). */
export async function downloadCurrentPageBatch(
  page: Page,
  config: InstahyreConfig,
  pageNumber: number,
  remainingToDownload: number,
): Promise<PageBatchResult> {
  const selectCount = Math.max(1, Math.min(remainingToDownload, INSTAHYRE_PAGE_SIZE));

  try {
    await dismissPromotionalModals(page);
    await waitForCandidateListReady(page, config.sessionValidateTimeoutMs);

    const { dir, files } = await downloadProfilesOnPage(
      page,
      config,
      pageNumber,
      selectCount,
    );

    await prepareForPagination(page);

    return {
      pageNumber,
      resumeCount: files.length,
      localPath: dir,
      status: 'downloaded',
      extractedDir: dir,
    };
  } catch (profileError) {
    const profileMessage =
      profileError instanceof Error ? profileError.message : String(profileError);
    logger.warn('Profile download failed; trying bulk zip download', {
      pageNumber,
      error: profileMessage,
    });
  }

  try {
    await dismissPromotionalModals(page);
    await waitForCandidateListReady(page, config.sessionValidateTimeoutMs);

    const expectedCount = await selectCandidatesForBatch(page, selectCount);
    await delay(500);

    if (!(await clickFirst(page, CANDIDATE_LIST.downloadResumes))) {
      throw new Error('Could not find "Download resumes" button');
    }

    await page.getByText(DOWNLOAD_MODAL.title).first().waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    const resumeCount = await parseResumeCountFromModal(page);
    if (resumeCount !== expectedCount) {
      logger.warn('Modal resume count differs from selected count', {
        expectedCount,
        resumeCount,
        pageNumber,
      });
    }

    const actualCount = Math.min(resumeCount, expectedCount);

    if (!(await checkFirst(page, DOWNLOAD_MODAL.zipCheckbox))) {
      const zipLabel = page.getByText('Zip file of resumes', { exact: false });
      if (await zipLabel.isVisible().catch(() => false)) {
        await zipLabel.click();
      } else {
        throw new Error('Could not find "Zip file of resumes" checkbox in modal');
      }
    }
    await delay(300);

    const downloadPromise = page.waitForEvent('download', {
      timeout: 120_000,
    });

    const modalDownload = page
      .getByRole('dialog')
      .getByRole('button', { name: /^Download$/i })
      .first();
    if (await modalDownload.isVisible().catch(() => false)) {
      await modalDownload.click({ timeout: 10_000 });
    } else if (!(await clickFirst(page, DOWNLOAD_MODAL.downloadButton))) {
      throw new Error('Could not find Download button in modal');
    }

    const download = await downloadPromise;
    const suggested = download.suggestedFilename() || `resumes-page-${pageNumber}.zip`;
    const fileName = `instahyre-page-${String(pageNumber).padStart(2, '0')}-${suggested}`;
    const localPath = path.join(config.localSaveDir, fileName);
    await download.saveAs(localPath);

    logger.info('Page batch downloaded', { pageNumber, resumeCount: actualCount, localPath });

    await delay(500);
    await page.keyboard.press('Escape').catch(() => undefined);
    await prepareForPagination(page);

    return {
      pageNumber,
      resumeCount: actualCount,
      localPath,
      status: 'downloaded',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Page batch download failed', { pageNumber, error: message });
    return {
      pageNumber,
      resumeCount: 0,
      localPath: '',
      status: 'failed',
      error: message,
    };
  }
}
