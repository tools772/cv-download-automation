import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

/** Optional popups that block the candidate list — dismiss if present. */
export async function dismissPromotionalModals(page: Page): Promise<void> {
  const dismissButtons = [
    /^Not now$/i,
    /^Skip$/i,
    /^Close$/i,
    /^Maybe later$/i,
    /^Got it$/i,
  ];

  for (const pattern of dismissButtons) {
    const btn = page.getByRole('button', { name: pattern }).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => undefined);
      await delay(300);
    }
  }

  const refreshJobs = page.getByText(/Want to refresh your jobs\?/i);
  const visible = await refreshJobs.isVisible({ timeout: 2500 }).catch(() => false);
  if (!visible) return;

  const notNow = page
    .getByRole('dialog')
    .getByRole('button', { name: /^Not now$/i })
    .or(page.getByRole('button', { name: /^Not now$/i }))
    .first();

  if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await notNow.click({ timeout: 5000 });
    await delay(400);
    logger.info('Dismissed "Want to refresh your jobs?" popup (Not now)');
    return;
  }

  // Fallback: any visible "Not now" while refresh-jobs copy is on screen
  const fallback = page.locator('button:has-text("Not now")').first();
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click({ timeout: 5000 });
    await delay(400);
    logger.info('Dismissed promotional popup via Not now button');
  }
}
