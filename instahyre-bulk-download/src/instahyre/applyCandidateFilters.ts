import type { Locator, Page } from 'playwright';
import { CANDIDATE_FILTERS, CANDIDATE_LIST } from './selectors.js';
import { dismissCrispChatWidget, dismissPromotionalModals } from './dismissPopups.js';
import { waitForCandidateListReady } from './waitForCandidateList.js';
import {
  enableHideViewedByMeViaAngular,
  invokeApplyFiltersViaAngular,
} from './angularFilters.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';
import { printInstahyreWarning } from './userErrors.js';

async function readResultsTotal(page: Page): Promise<number | null> {
  const body = await page.locator('body').innerText().catch(() => '');
  const match = body.match(CANDIDATE_LIST.resultsSummary);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

async function findFilterPanel(page: Page): Promise<Locator | null> {
  for (const selector of CANDIDATE_FILTERS.panel) {
    const panel = page.locator(selector).first();
    if ((await panel.count()) === 0) continue;
    if (await panel.isVisible().catch(() => false)) {
      return panel;
    }
  }
  return null;
}

async function isFilterPanelOpen(page: Page): Promise<boolean> {
  if (await findFilterPanel(page)) {
    return true;
  }

  return (
    (await page.getByText(/Filter results/i).first().isVisible().catch(() => false)) ||
    (await page.getByText(/Display options/i).first().isVisible().catch(() => false)) ||
    (await page.getByText(/Hide viewed by me/i).first().isVisible().catch(() => false)) ||
    (await page.getByRole('button', { name: /^Apply$/i }).first().isVisible().catch(() => false))
  );
}

async function clickFirstVisible(root: Page | Locator, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const el = root.locator(selector).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    if ((await el.getAttribute('disabled')) !== null) continue;
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await el.click({ timeout: 8000, force: true });
    return true;
  }
  return false;
}

async function isApplyControlDisabled(applyEl: Locator): Promise<boolean> {
  if ((await applyEl.getAttribute('disabled')) !== null) {
    return true;
  }
  return (await applyEl.getAttribute('aria-disabled')) === 'true';
}

async function toggleHideViewedViaDom(panel: Locator): Promise<'toggled' | 'already' | 'missing'> {
  return panel.evaluate((root) => {
    const labels = Array.from(root.querySelectorAll('label, div, span, li'));
    for (const el of labels) {
      const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!/^Hide viewed by me(\s*\(\d+\))?$/i.test(text)) continue;

      const container = el.closest('label, li, div') ?? el.parentElement;
      const input = container?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!input) continue;

      if (input.checked) {
        return 'already';
      }

      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'toggled';
    }
    return 'missing';
  });
}

async function getApplyStateFromPage(page: Page): Promise<'ready' | 'already' | 'missing' | 'disabled'> {
  return page.evaluate(() => {
    const apply = (() => {
      const selectors = [
        'div.filter-footer .btn-success',
        'div.filter-footer [ng-click*="applyFilters"]',
        '.sliding-filters.active .filter-footer .btn-success',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) return el;
      }
      const drawer = document.querySelector('.sliding-filters.active, div.sliding-filters.active');
      const siblingApply = drawer?.parentElement?.querySelector(
        'div.filter-footer .btn-success, div.filter-footer [ng-click*="applyFilters"]',
      ) as HTMLElement | null;
      return siblingApply;
    })();

    if (!apply) {
      return 'missing';
    }

    const tooltip =
      apply.getAttribute('tooltip-text') ??
      apply.getAttribute('data-original-title') ??
      apply.getAttribute('title') ??
      '';

    if (apply.hasAttribute('disabled') || apply.getAttribute('aria-disabled') === 'true') {
      if (/no changes made/i.test(tooltip)) {
        return 'already';
      }
      return 'disabled';
    }

    return 'ready';
  });
}

async function clickApplyFromPage(page: Page): Promise<'clicked' | 'already' | 'missing' | 'disabled'> {
  const state = await getApplyStateFromPage(page);
  if (state === 'missing' || state === 'disabled') {
    return state;
  }
  if (state === 'already') {
    return 'already';
  }

  return page.evaluate(() => {
    const apply = (() => {
      const selectors = [
        'div.filter-footer .btn-success',
        'div.filter-footer [ng-click*="applyFilters"]',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) return el;
      }
      const drawer = document.querySelector('.sliding-filters.active, div.sliding-filters.active');
      return drawer?.parentElement?.querySelector(
        'div.filter-footer .btn-success, div.filter-footer [ng-click*="applyFilters"]',
      ) as HTMLElement | null;
    })();

    if (!apply) {
      return 'missing';
    }

    apply.scrollIntoView({ block: 'center' });

    const angular = (window as unknown as { angular?: { element: (el: Element) => { scope?: () => Record<string, unknown> } } }).angular;
    if (angular) {
      try {
        const scope = angular.element(apply).scope?.();
        if (scope && typeof scope.applyFilters === 'function') {
          const $apply = scope.$apply as ((fn: () => void) => void) | undefined;
          if (typeof $apply === 'function') {
            $apply.call(scope, () => (scope.applyFilters as () => void)());
          } else {
            (scope.applyFilters as () => void)();
          }
          return 'clicked';
        }
      } catch {
        // fall through to DOM click
      }
    }

    apply.click();
    return 'clicked';
  });
}

async function getApplyState(panel: Locator): Promise<'ready' | 'already' | 'missing' | 'disabled'> {
  return panel.evaluate((root) => {
    const apply = root.querySelector(
      '.filter-footer .btn-success, .filter-footer [ng-click*="applyFilters"]',
    ) as HTMLElement | null;
    if (!apply) {
      return 'missing';
    }

    const tooltip =
      apply.getAttribute('tooltip-text') ??
      apply.getAttribute('data-original-title') ??
      apply.getAttribute('title') ??
      '';

    if (apply.hasAttribute('disabled') || apply.getAttribute('aria-disabled') === 'true') {
      if (/no changes made/i.test(tooltip)) {
        return 'already';
      }
      return 'disabled';
    }

    return 'ready';
  });
}

async function clickApplyViaDom(panel: Locator): Promise<'clicked' | 'already' | 'missing' | 'disabled'> {
  const state = await getApplyState(panel);
  if (state === 'missing' || state === 'disabled') {
    return state;
  }
  if (state === 'already') {
    return 'already';
  }

  return panel.evaluate((root) => {
    const apply = root.querySelector(
      '.filter-footer .btn-success, .filter-footer [ng-click*="applyFilters"]',
    ) as HTMLElement | null;
    if (!apply) {
      return 'missing';
    }
    apply.scrollIntoView({ block: 'center' });
    apply.click();
    return 'clicked';
  });
}

async function clickFilterButtonAndWait(page: Page, locator: ReturnType<Page['locator']>): Promise<boolean> {
  if ((await locator.count()) === 0) return false;
  if (!(await locator.isVisible().catch(() => false))) return false;
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ timeout: 8000, force: true });
  await delay(500);
  return await isFilterPanelOpen(page);
}

/** Open the right-hand Filter results panel (funnel icon in the candidate toolbar). */
export async function openFilterPanel(page: Page): Promise<boolean> {
  if (await isFilterPanelOpen(page)) {
    return true;
  }

  await dismissPromotionalModals(page);

  // Instahyre: div.filter-button next to sort icon (not a semantic button)
  const filterDiv = page.locator('div.filter-button').first();
  if (await clickFilterButtonAndWait(page, filterDiv)) {
    return true;
  }

  const filterNearToolbar = page
    .locator('div, section')
    .filter({ hasText: /Download resumes/i })
    .locator('div.filter-button')
    .first();
  if (await clickFilterButtonAndWait(page, filterNearToolbar)) {
    return true;
  }

  if (await clickFirstVisible(page, CANDIDATE_FILTERS.openPanel)) {
    await delay(500);
    if (await isFilterPanelOpen(page)) {
      return true;
    }
  }

  const filterButton = page.getByRole('button', { name: /filter/i }).first();
  if (await filterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await filterButton.click({ timeout: 8000 });
    await delay(500);
    if (await isFilterPanelOpen(page)) {
      return true;
    }
  }

  // Toolbar row: Select all | Share | Download resumes | … | sort | filter (funnel)
  const actionRow = page
    .locator('div, section, header')
    .filter({ hasText: /^Select all$/i })
    .filter({ hasText: /Download resumes/i })
    .first();
  if (await actionRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    const iconButtons = actionRow.locator(
      'div.filter-button, button:has(svg), a:has(svg), [class*="icon"]',
    );
    const iconCount = await iconButtons.count().catch(() => 0);
    for (let i = iconCount - 1; i >= Math.max(0, iconCount - 3); i--) {
      const btn = iconButtons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 8000 }).catch(() => undefined);
      await delay(500);
      if (await isFilterPanelOpen(page)) {
        return true;
      }
    }
  }

  // Icon-only funnel near "Showing X - Y of Z results" / Select all toolbar
  const nearResults = page
    .getByText(/Showing\s+\d+\s*-\s*\d+\s+of\s+\d+\s+results/i)
    .locator('xpath=ancestor::*[self::div or self::section][1]');
  const toolbarButtons = nearResults.locator(
    'div.filter-button, button, a[role="button"], [role="button"]',
  );
  const buttonCount = await toolbarButtons.count().catch(() => 0);
  for (let i = buttonCount - 1; i >= Math.max(0, buttonCount - 4); i--) {
    const btn = toolbarButtons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click({ timeout: 8000 }).catch(() => undefined);
    await delay(500);
    if (await isFilterPanelOpen(page)) {
      return true;
    }
  }

  return false;
}

/** Check "Hide viewed by me" via Angular ng-model, then Playwright/DOM fallbacks. */
export async function checkHideViewedByMe(page: Page): Promise<boolean> {
  await dismissPromotionalModals(page);

  const angularResult = await enableHideViewedByMeViaAngular(page);
  if (angularResult === 'enabled') {
    logger.info('Hide viewed by me enabled via Angular ng-model');
    await delay(300);
    return true;
  }
  if (angularResult === 'already') {
    logger.info('Hide viewed by me already enabled in Angular model');
    return true;
  }
  if (angularResult === 'no_angular') {
    logger.warn('Angular not available — falling back to DOM checkbox toggle');
  }

  const filterPanel = await findFilterPanel(page);
  const panel = filterPanel ?? page.locator('body');

  if (filterPanel) {
    const toggleResult = await toggleHideViewedViaDom(filterPanel);
    if (toggleResult === 'toggled') {
      await delay(400);
      return true;
    }
    if (toggleResult === 'already') {
      logger.info('Hide viewed by me already checked in filter panel');
      return true;
    }
  }

  for (const pattern of CANDIDATE_FILTERS.hideViewedByMeLabels) {
    const byRole = panel.getByRole('checkbox', { name: pattern }).first();
    if (await byRole.isVisible({ timeout: 1500 }).catch(() => false)) {
      if (!(await byRole.isChecked().catch(() => false))) {
        await byRole.check({ timeout: 8000 }).catch(async () => {
          await byRole.click({ timeout: 8000, force: true });
        });
      }
      return true;
    }

    const label = panel.getByText(pattern).first();
    if (await label.isVisible({ timeout: 1500 }).catch(() => false)) {
      const rowCheckbox = label.locator('xpath=ancestor::label[1]//input[@type="checkbox"]').first();
      if ((await rowCheckbox.count()) > 0) {
        if (!(await rowCheckbox.isChecked().catch(() => false))) {
          await rowCheckbox.check({ timeout: 8000 }).catch(async () => {
            await label.click({ timeout: 8000, force: true });
          });
        }
        return true;
      }

      const siblingCheckbox = label
        .locator('xpath=preceding-sibling::input[@type="checkbox"][1]')
        .first();
      if ((await siblingCheckbox.count()) > 0) {
        if (!(await siblingCheckbox.isChecked().catch(() => false))) {
          await siblingCheckbox.check({ timeout: 8000 }).catch(async () => {
            await label.click({ timeout: 8000, force: true });
          });
        }
        return true;
      }

      const row = label.locator('xpath=ancestor::*[self::div or self::li or self::label][1]');
      const rowInput = row.locator('input[type="checkbox"]').first();
      if ((await rowInput.count()) > 0) {
        if (!(await rowInput.isChecked().catch(() => false))) {
          await rowInput.check({ timeout: 8000 }).catch(async () => {
            await label.click({ timeout: 8000, force: true });
          });
        }
        return true;
      }

      await label.click({ timeout: 8000, force: true });
      return true;
    }
  }

  for (const selector of CANDIDATE_FILTERS.hideViewedByMeCheckbox) {
    const el = panel.locator(selector).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isChecked().catch(() => false))) {
      await el.check({ timeout: 8000 }).catch(async () => {
        await el.click({ timeout: 8000, force: true });
      });
    }
    return true;
  }

  return false;
}

/** Commit filter changes — Angular applyFilters() first, then enabled Apply click. */
export async function clickApplyFilters(page: Page): Promise<boolean> {
  await dismissCrispChatWidget(page);
  await dismissPromotionalModals(page);

  const panel = await findFilterPanel(page);
  if (panel) {
    await panel
      .evaluate((root) => {
        const scrollable = root.querySelector(
          '.filter-content, .sliding-filters-content, .filters-body',
        );
        if (scrollable instanceof HTMLElement) {
          scrollable.scrollTop = scrollable.scrollHeight;
        }
      })
      .catch(() => undefined);
  }

  await dismissCrispChatWidget(page);

  const angularApply = await invokeApplyFiltersViaAngular(page);
  if (angularApply === 'applied') {
    logger.info('Invoked applyFilters() via Angular scope');
    await delay(800);
    return true;
  }
  if (angularApply === 'no_angular') {
    logger.warn('Angular applyFilters not available — trying Apply button');
  }

  let domResult = await clickApplyFromPage(page);

  if (domResult === 'disabled') {
    await delay(400);
    domResult = await clickApplyFromPage(page);
  }

  if (domResult === 'clicked') {
    await delay(600);
    return true;
  }

  if (!panel) {
    return false;
  }

  domResult = await clickApplyViaDom(panel);
  if (domResult === 'clicked') {
    await delay(600);
    return true;
  }

  const footer = page.locator('div.filter-footer').first();
  if (await footer.isVisible({ timeout: 1500 }).catch(() => false)) {
    const applyEl = footer.locator('[ng-click*="applyFilters"], .btn-success').first();
    if ((await applyEl.count()) > 0 && !(await isApplyControlDisabled(applyEl))) {
      await dismissCrispChatWidget(page);
      await applyEl.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
      await delay(600);
      return !(await findFilterPanel(page));
    }
  }

  return false;
}

/** Close the filter drawer so it does not block candidate checkboxes. */
export async function closeFilterPanel(page: Page): Promise<boolean> {
  const panel = await findFilterPanel(page);
  if (!panel) {
    return true;
  }

  await dismissCrispChatWidget(page);

  const footer = page.locator('div.filter-footer').first();
  if (await footer.isVisible({ timeout: 1500 }).catch(() => false)) {
    for (const selector of ['a:has-text("Cancel")', 'button:has-text("Cancel")']) {
      const cancelEl = footer.locator(selector).first();
      if ((await cancelEl.count()) === 0) continue;
      if (!(await cancelEl.isVisible().catch(() => false))) continue;
      await cancelEl.click({ timeout: 8000, force: true });
      await delay(400);
      if (!(await findFilterPanel(page))) {
        return true;
      }
    }
  }

  if (await clickFirstVisible(page, CANDIDATE_FILTERS.cancelButton)) {
    await delay(400);
    if (!(await findFilterPanel(page))) {
      return true;
    }
  }

  const filterToggle = page.locator('div.filter-button').first();
  if (await filterToggle.isVisible({ timeout: 1500 }).catch(() => false)) {
    await filterToggle.click({ timeout: 8000, force: true });
    await delay(400);
    if (!(await findFilterPanel(page))) {
      return true;
    }
  }

  await page.keyboard.press('Escape').catch(() => undefined);
  await delay(400);
  return !(await findFilterPanel(page));
}

/** Ensure filter drawer is not covering the candidate list before bulk select. */
export async function ensureFilterPanelClosed(page: Page): Promise<void> {
  if (!(await findFilterPanel(page))) {
    return;
  }
  logger.warn('Filter panel still open before download — closing it');
  await closeFilterPanel(page);
}

/**
 * Open filters and enable "Hide viewed by me" before bulk download.
 * Non-fatal if UI changes — download continues with the default list.
 */
export async function applyHideViewedByMeFilter(
  page: Page,
  sessionValidateTimeoutMs: number,
): Promise<boolean> {
  try {
    await dismissPromotionalModals(page);
    const resultsBefore = await readResultsTotal(page);

    const opened = await openFilterPanel(page);
    if (!opened) {
      logger.warn('Instahyre filter panel not found — skipping Hide viewed by me');
      printInstahyreWarning(
        'Could not open the filter panel (funnel icon). Continuing without "Hide viewed by me".',
      );
      return false;
    }

    const checkboxSet = await checkHideViewedByMe(page);
    if (!checkboxSet) {
      logger.warn('Hide viewed by me checkbox not found — continuing with current list');
      printInstahyreWarning(
        'Filter panel opened but "Hide viewed by me" was not found. Continuing with the current list.',
      );
      return false;
    }

    await delay(300);
    const applyClicked = await clickApplyFilters(page);
    if (!applyClicked) {
      logger.warn('Instahyre filter could not invoke applyFilters — closing panel');
      printInstahyreWarning(
        'Checked "Hide viewed by me" but could not apply filters. Closing filter panel — list may be unfiltered.',
      );
      return false;
    }

    await page
      .locator('div.sliding-filters.active')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await waitForCandidateListReady(page, Math.min(sessionValidateTimeoutMs, 45_000));

    const resultsAfter = await readResultsTotal(page);
    const filterTookEffect =
      resultsBefore != null &&
      resultsAfter != null &&
      resultsAfter < resultsBefore;

    if (filterTookEffect) {
      logger.info('Hide viewed by me filter applied', { resultsBefore, resultsAfter });
      console.log(
        `Instahyre filter applied: Hide viewed by me → ${resultsBefore} → ${resultsAfter} results`,
      );
      return true;
    }

    if (resultsBefore != null && resultsAfter != null && resultsBefore === resultsAfter) {
      logger.warn('applyFilters ran but result count unchanged — filter may not be active', {
        resultsBefore,
        resultsAfter,
      });
      printInstahyreWarning(
        `Filter Apply ran but result count unchanged (${resultsAfter}). Continuing with current list.`,
      );
      return false;
    }

    logger.info('Hide viewed by me filter applied (result count not verified)');
    console.log('Instahyre filter applied: Hide viewed by me → Apply');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Instahyre filter step failed — closing panel and continuing', { error: message });
    printInstahyreWarning(`Filter step failed (${message}). Continuing download.`);
    return false;
  } finally {
    await ensureFilterPanelClosed(page);
  }
}
