import type { Page } from 'playwright';
import { dismissPromotionalModals } from './dismissPopups.js';
import { waitForCandidateListReady } from './waitForCandidateList.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

export const INSTAHYRE_PAGE_SIZE = 30;

const SHOWING_RANGE = /Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+results/i;

export function parseShowingRange(text: string): { start: number; end: number; total: number } | null {
  const match = text.match(SHOWING_RANGE);
  if (!match) return null;
  return {
    start: Number.parseInt(match[1]!, 10),
    end: Number.parseInt(match[2]!, 10),
    total: Number.parseInt(match[3]!, 10),
  };
}

async function getShowingRange(page: Page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return parseShowingRange(text);
}

/** Scroll to the bottom pagination bar (URL does not change on Instahyre). */
async function scrollToPagination(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
    await delay(350);
  }
}

/** After bulk download: close overlays and clear selection so Next is clickable. */
export async function prepareForPagination(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await delay(300);
  await dismissPromotionalModals(page);

  const selectAll = page.getByText('Select all', { exact: true }).first();
  if (await selectAll.isVisible().catch(() => false)) {
    const checkbox = page.locator('label:has-text("Select all") input[type="checkbox"]').first();
    if (await checkbox.isChecked().catch(() => false)) {
      await selectAll.click({ timeout: 5000 }).catch(() => undefined);
      await delay(400);
    }
  }
}

async function waitForListAdvanced(page: Page, beforeStart: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (start) => {
        const m = document.body.innerText.match(
          /Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+results/i,
        );
        return Boolean(m && Number.parseInt(m[1]!, 10) > start);
      },
      beforeStart,
      { timeout: 25_000 },
    );
    await waitForCandidateListReady(page, 15_000);
    await delay(500);
    return true;
  } catch {
    return false;
  }
}

function paginationRoot(page: Page) {
  return page.locator('.pagination, ul.pagination, [class*="pagination"], nav.pagination').last();
}

/** Click the "Next »" control at the bottom of the candidate list. */
async function clickBottomNext(page: Page): Promise<boolean> {
  await scrollToPagination(page);

  const roots = [
    paginationRoot(page),
    page.locator('footer').last(),
    page.locator('body'),
  ];

  const nextPatterns = [
    /^Next\s*»\s*$/,
    /^Next\s*›\s*$/,
    /^Next\s*>>\s*$/,
    /^Next\s*$/,
  ];

  for (const root of roots) {
    for (const pattern of nextPatterns) {
      const candidates = [
        root.getByRole('link', { name: pattern }),
        root.locator('a').filter({ hasText: pattern }),
        root.locator('button').filter({ hasText: pattern }),
        root.getByText(pattern),
      ];

      for (const locator of candidates) {
        const el = locator.first();
        if ((await el.count()) === 0) continue;
        if (!(await el.isVisible().catch(() => false))) continue;

        const cls = (await el.getAttribute('class')) ?? '';
        const ariaDisabled = await el.getAttribute('aria-disabled');
        const parent = el.locator('xpath=..');
        const parentCls = (await parent.getAttribute('class').catch(() => '')) ?? '';
        if (/disabled|inactive|hidden/i.test(`${cls} ${parentCls}`) || ariaDisabled === 'true') {
          continue;
        }

        await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
        await delay(200);
        await el.click({ timeout: 12_000, force: false });
        logger.info('Clicked bottom Next control');
        return true;
      }
    }
  }

  return false;
}

async function clickPageNumber(page: Page, pageNum: number): Promise<boolean> {
  await scrollToPagination(page);
  const root = paginationRoot(page);

  const pageLink = root
    .locator('a, button')
    .filter({ hasText: new RegExp(`^\\s*${pageNum}\\s*$`) })
    .first();

  if ((await pageLink.count()) === 0) return false;
  if (!(await pageLink.isVisible().catch(() => false))) return false;

  const cls = (await pageLink.getAttribute('class')) ?? '';
  if (/active|current|disabled/i.test(cls)) return false;

  await pageLink.scrollIntoViewIfNeeded().catch(() => undefined);
  await pageLink.click({ timeout: 12_000 });
  logger.info('Clicked pagination page number', { pageNum });
  return true;
}

export async function goToNextCandidatesPage(
  page: Page,
  currentPageNumber: number,
): Promise<boolean> {
  await prepareForPagination(page);

  const beforeRange = await getShowingRange(page);
  const beforeStart =
    beforeRange?.start ?? (currentPageNumber - 1) * INSTAHYRE_PAGE_SIZE + 1;

  if (beforeRange && beforeRange.end >= beforeRange.total) {
    logger.info('Already on last page of results', beforeRange);
    return false;
  }

  logger.info('Clicking bottom Next to paginate', {
    beforeStart,
    showing: beforeRange,
    pageNumber: currentPageNumber,
  });

  // Primary: bottom "Next »" (same URL, SPA list update)
  if (await clickBottomNext(page)) {
    if (await waitForListAdvanced(page, beforeStart)) {
      const after = await getShowingRange(page);
      logger.info('List advanced after Next click', { after });
      return true;
    }
    logger.warn('Next was clicked but candidate list did not advance');
  }

  await prepareForPagination(page);

  // Fallback: click page number 2, 3, …
  if (await clickPageNumber(page, currentPageNumber + 1)) {
    if (await waitForListAdvanced(page, beforeStart)) {
      const after = await getShowingRange(page);
      logger.info('List advanced after page number click', { after });
      return true;
    }
  }

  logger.warn('Failed to paginate via bottom Next', {
    beforeRange,
    afterRange: await getShowingRange(page),
  });
  return false;
}
