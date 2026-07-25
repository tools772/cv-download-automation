import type { Locator, Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

const ACTIVE_IN_DAYS = 30;

/** Rewrite Resdex URL so Active in = N days (activeIn query param). */
export function withActiveInDays(url: string, days = ACTIVE_IN_DAYS): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('activeIn', String(days));
    return parsed.toString();
  } catch {
    return url;
  }
}

async function pickVisibleOption(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const exact = page.getByRole('option', { name: label, exact: true }).first();
    if (await exact.isVisible({ timeout: 800 }).catch(() => false)) {
      await exact.click({ timeout: 8000 });
      await delay(400);
      return true;
    }

    const menuItem = page.getByRole('menuitem', { name: label, exact: true }).first();
    if (await menuItem.isVisible({ timeout: 500 }).catch(() => false)) {
      await menuItem.click({ timeout: 8000 });
      await delay(400);
      return true;
    }

    // Naukri custom dropdown list items (as in Active in menu)
    const listItem = page
      .locator('li, [role="option"], [class*="option"], [class*="dropdown"] div, [class*="menu"] div')
      .filter({ hasText: new RegExp(`^\\s*${label.replace(/\s+/g, '\\s+')}\\s*$`, 'i') })
      .first();
    if (await listItem.isVisible({ timeout: 500 }).catch(() => false)) {
      await listItem.click({ timeout: 8000 });
      await delay(400);
      return true;
    }
  }
  return false;
}

async function clickNearbyDropdown(
  page: Page,
  anchor: Locator,
  alreadySet: RegExp,
): Promise<boolean> {
  if (!(await anchor.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }

  const container = anchor.locator(
    'xpath=ancestor::*[self::div or self::section or self::li or self::label][1]',
  );
  const scope = (await container.count()) > 0 ? container : anchor;

  const scopeText = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (alreadySet.test(scopeText)) {
    return true;
  }

  // Prefer a combobox / button / select next to the label
  const triggers = [
    scope.locator('select').first(),
    scope.getByRole('combobox').first(),
    scope.getByRole('button').first(),
    scope.locator('[aria-haspopup="listbox"], [aria-haspopup="menu"]').first(),
    scope
      .locator('div, span, button')
      .filter({ hasText: /\d+\s*days|year|month|Viewed|Emailed|Anyone|\bMe\b/i })
      .first(),
  ];

  for (const trigger of triggers) {
    if ((await trigger.count()) === 0) continue;
    if (!(await trigger.isVisible().catch(() => false))) continue;

    const tag = await trigger.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') {
      try {
        await trigger.selectOption({ label: '30 days' });
        await delay(400);
        return true;
      } catch {
        // fall through to click path
      }
    }

    const current = (await trigger.innerText().catch(() => '')).trim();
    if (alreadySet.test(current)) {
      return true;
    }

    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 8000 }).catch(() => undefined);
    await delay(400);
    return true;
  }

  // Last resort: click the anchor itself / following sibling
  await anchor.click({ timeout: 8000 }).catch(() => undefined);
  await delay(400);
  return true;
}

/** Set toolbar "Active in" to 30 days via UI (backup to URL rewrite). */
export async function setActiveInThirtyDays(page: Page): Promise<boolean> {
  if (/activeIn=30\b/i.test(page.url())) {
    const near = page
      .locator('div, section, header')
      .filter({ hasText: /Active in/i })
      .filter({ hasText: /30\s*days/i })
      .first();
    if (await near.isVisible({ timeout: 3000 }).catch(() => false)) {
      return true;
    }
  }

  const label = page.getByText(/Active in/i).first();
  if (!(await label.isVisible({ timeout: 8000 }).catch(() => false))) {
    logger.warn('Active in label not found on Resdex page');
    return /activeIn=30\b/i.test(page.url());
  }

  const container = label.locator(
    'xpath=ancestor::*[self::div or self::section or self::li][position()<=3][1]',
  );
  const scope = (await container.count()) > 0 ? container : page.locator('body');
  const scopeText = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (/Active in[\s\S]{0,40}30\s*days/i.test(scopeText)) {
    return true;
  }

  // Current value is often "1 year" — match year/month/days, not only "days"
  const trigger = scope
    .locator('select, button, [role="combobox"], [aria-haspopup], div, span')
    .filter({ hasText: /\d+\s*days|\d+\s*year|month|1 year/i })
    .first();

  if ((await trigger.count()) > 0 && (await trigger.isVisible().catch(() => false))) {
    const tag = await trigger.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') {
      try {
        await trigger.selectOption({ label: '30 days' });
        await delay(600);
        return true;
      } catch {
        // fall through
      }
    }
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 8000 });
    await delay(450);
  } else {
    await clickNearbyDropdown(page, label, /30\s*days/i);
  }

  const picked =
    (await pickVisibleOption(page, ['30 days', '30 Days'])) ||
    (await page
      .getByText(/^30 days$/i)
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false));

  if (!picked) {
    return /activeIn=30\b/i.test(page.url());
  }

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await delay(800);
  return (
    /activeIn=30\b/i.test(page.url()) ||
    /Active in[\s\S]{0,40}30\s*days/i.test(await page.locator('body').innerText().catch(() => ''))
  );
}

async function hideProfilesCard(page: Page): Promise<Locator> {
  // Prefer the card that also contains "which have been" / "within last"
  const card = page
    .locator('div, section, aside, form')
    .filter({ hasText: /Hide Profiles/i })
    .filter({ hasText: /which have been|within last/i })
    .first();
  if ((await card.count()) > 0 && (await card.isVisible().catch(() => false))) {
    return card;
  }
  return page
    .locator('div, section, aside')
    .filter({ hasText: /Hide Profiles/i })
    .first();
}

async function ensureHideProfilesChecked(page: Page, card: Locator): Promise<boolean> {
  const checkbox = card.locator('input[type="checkbox"]').first();
  if ((await checkbox.count()) > 0) {
    const checked = await checkbox.isChecked().catch(() => false);
    if (!checked) {
      await checkbox.check({ timeout: 8000 }).catch(async () => {
        await checkbox.click({ timeout: 8000, force: true });
      });
    }
    return true;
  }

  const byRole = page.getByRole('checkbox', { name: /Hide Profiles/i }).first();
  if (await byRole.isVisible({ timeout: 2000 }).catch(() => false)) {
    if (!(await byRole.isChecked().catch(() => false))) {
      await byRole.check({ timeout: 8000 });
    }
    return true;
  }

  const label = card.getByText(/Hide Profiles/i).first();
  if (await label.isVisible().catch(() => false)) {
    await label.click({ timeout: 8000 });
    return true;
  }
  return false;
}

async function pickDropdownInCard(
  page: Page,
  card: Locator,
  currentPatterns: RegExp[],
  optionLabels: string[],
): Promise<boolean> {
  for (const pattern of currentPatterns) {
    const trigger = card
      .locator('button, [role="combobox"], [aria-haspopup], select, div, span')
      .filter({ hasText: pattern })
      .first();
    if ((await trigger.count()) === 0) continue;
    if (!(await trigger.isVisible().catch(() => false))) continue;

    const current = (await trigger.innerText().catch(() => '')).trim();
    if (
      optionLabels.some(
        (l) =>
          new RegExp(`^${l}$`, 'i').test(current) ||
          new RegExp(l.replace(/\s+/g, '\\s+'), 'i').test(current),
      )
    ) {
      return true;
    }

    const tag = await trigger.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') {
      for (const label of optionLabels) {
        try {
          await trigger.selectOption({ label });
          await delay(400);
          return true;
        } catch {
          // next
        }
      }
    }

    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 8000, force: true });
    await delay(400);
    if (await pickVisibleOption(page, optionLabels)) {
      return true;
    }
  }
  return false;
}

/**
 * Hide Profiles: Downloaded (preferred) or Viewed / within last 30 days / by Anyone.
 * "Viewed" alone often leaves previously downloaded CVs on the first page —
 * automation downloads mark activity as Downloaded more reliably than Viewed.
 */
export async function applyHideProfilesFilter(page: Page): Promise<boolean> {
  const card = await hideProfilesCard(page);
  if ((await card.count()) === 0 || !(await card.isVisible().catch(() => false))) {
    logger.warn('Hide Profiles card not found');
    return false;
  }

  if (!(await ensureHideProfilesChecked(page, card))) {
    return false;
  }
  // Dropdowns often mount only after the checkbox is checked.
  await delay(900);

  // Prefer Downloaded so prior CV fetches disappear from the SRP; fall back to Viewed.
  let actionOk = await pickDropdownInCard(
    page,
    card,
    [/^Downloaded$/i, /Downloaded|Viewed|Emailed|Contacted/i],
    ['Downloaded'],
  );
  if (!actionOk) {
    actionOk = await pickDropdownInCard(
      page,
      card,
      [/^Viewed$/i, /Viewed|Emailed|Contacted|Downloaded/i],
      ['Viewed'],
    );
  }

  // Days dropdown sits after "within last" — try that anchor first, then generic.
  let daysOk = await setHideProfilesDays(page, card);
  if (!daysOk) {
    daysOk = await pickDropdownInCard(
      page,
      card,
      [/\d+\s*days/i, /month|year|within last/i],
      ['30 days', '30 Days', 'Last 30 days', 'Last 30 Days'],
    );
  }

  // Prefer Anyone; accept Me if Anyone is unavailable
  let byOk = await pickDropdownInCard(page, card, [/^Anyone$/i, /^Me$/i, /\bMe\b|\bAnyone\b|\bTeam\b/i], [
    'Anyone',
  ]);
  if (!byOk) {
    byOk = await pickDropdownInCard(page, card, [/^Me$/i, /\bMe\b|\bAnyone\b/i], ['Me', 'Anyone']);
  }

  // Some Resdex UIs need an explicit Hide / Apply on the card after dropdowns.
  await clickHideProfilesApply(page, card);

  const cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 280);
  if (!actionOk || !daysOk || !byOk) {
    logger.warn('Hide Profiles dropdowns incomplete', { actionOk, daysOk, byOk, cardText });
  } else {
    logger.info('Hide Profiles dropdowns set', { cardText });
  }

  return actionOk && daysOk && byOk;
}

async function clickHideProfilesApply(_page: Page, card: Locator): Promise<void> {
  const labels = [/^Hide Profiles$/i, /^Apply$/i, /^Hide$/i];
  for (const name of labels) {
    const inCard = card.getByRole('button', { name }).first();
    if (await inCard.isVisible({ timeout: 500 }).catch(() => false)) {
      await inCard.click({ timeout: 8000 }).catch(() => undefined);
      logger.info('Clicked Hide Profiles apply on card', { name: String(name) });
      await delay(600);
      return;
    }
  }
}

/** Set the "within last … days" dropdown on the Hide Profiles card to 30 days. */
async function setHideProfilesDays(page: Page, card: Locator): Promise<boolean> {
  const readCard = async () =>
    (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');

  let cardText = await readCard();
  if (/within\s+last\s+30\s*days/i.test(cardText)) {
    return true;
  }

  // Live UI often shows "within last 7 days" — click that exact control.
  const dayTriggers = [
    card.getByText(/\b7\s*days\b/i).first(),
    card.getByText(/\b15\s*days\b/i).first(),
    card.getByText(/\b3\s*days\b/i).first(),
    card.getByText(/\b1\s*day\b/i).first(),
    card.getByText(/\b\d+\s*days\b/i).first(),
    card.getByText(/\b1\s*month\b/i).first(),
    card.getByText(/\b6\s*months\b/i).first(),
  ];

  for (const trigger of dayTriggers) {
    if (!(await trigger.isVisible({ timeout: 600 }).catch(() => false))) continue;
    const label = (await trigger.innerText().catch(() => '')).trim();
    // Skip if this match is outside the Hide Profiles sentence (e.g. Active in).
    const nearHide = await trigger
      .evaluate((el) => {
        const root = el.closest('div, section, aside, form, li, label')?.textContent ?? '';
        return /hide profiles|within last/i.test(root);
      })
      .catch(() => false);
    if (!nearHide && !/within\s+last/i.test(cardText)) continue;
    if (/^30\s*days$/i.test(label)) return true;

    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 8000, force: true });
    await delay(500);

    const picked =
      (await pickVisibleOption(page, ['30 days', '30 Days', 'Last 30 days', 'Last 30 Days'])) ||
      (await page
        .locator('[role="option"], [role="menuitem"], li, div')
        .filter({ hasText: /^30\s*days$/i })
        .first()
        .click({ timeout: 4000 })
        .then(() => true)
        .catch(() => false));

    if (picked) {
      await delay(800);
      cardText = await readCard();
      if (/within\s+last\s+30\s*days/i.test(cardText)) return true;
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await delay(200);
  }

  // Fallback: control immediately after "within last"
  const withinLast = card.getByText(/within\s+last/i).first();
  if (await withinLast.isVisible({ timeout: 1500 }).catch(() => false)) {
    const nearby = withinLast.locator(
      'xpath=following::*[self::button or self::select or @role="combobox" or @aria-haspopup or self::span or self::div][1]',
    );
    if ((await nearby.count()) > 0) {
      const trigger = nearby.first();
      const current = (await trigger.innerText().catch(() => '')).trim();
      if (/30\s*days/i.test(current)) return true;
      await trigger.click({ timeout: 8000, force: true }).catch(() => undefined);
      await delay(450);
      if (
        (await pickVisibleOption(page, ['30 days', '30 Days'])) ||
        (await page.getByText(/^30\s*days$/i).first().click({ timeout: 4000 }).then(() => true).catch(() => false))
      ) {
        await delay(800);
      }
    }
  }

  cardText = await readCard();
  return /within\s+last\s+30\s*days/i.test(cardText);
}

export type ResdexFilterResult = {
  ok: boolean;
  activeOk: boolean;
  hideOk: boolean;
  resultsChanged: boolean;
  reason?: string;
  beforeLabel?: string;
  afterLabel?: string;
};

/**
 * Apply Resdex filters and wait for the result list to refresh.
 * Returns ok=false when filters are not confirmed — caller must NOT index/download.
 *
 * Note: Naukri often rewrites activeIn=30 back to the saved-search value (e.g. 23)
 * in the URL. We treat the on-page "Active in … 30 days" control as source of truth.
 */
export async function applyResdexSearchFilters(page: Page): Promise<ResdexFilterResult> {
  await delay(800);

  // Best-effort URL rewrite, then always set Active in via the toolbar UI.
  if (!/activeIn=30\b/i.test(page.url())) {
    const corrected = withActiveInDays(page.url());
    logger.info('Navigating to Active in=30 before filters', {
      from: page.url(),
      to: corrected,
    });
    console.log('Naukri: opening search with Active in=30…');
    await page.goto(corrected, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await delay(800);
  }

  const before = await readSearchFingerprint(page);
  logger.info('Search fingerprint before filters', before);
  console.log(
    before.totalLabel
      ? `Naukri: applying filters (current list: ${before.totalLabel})…`
      : 'Naukri: applying filters…',
  );

  // 1) Active in via UI (URL alone is unreliable for this saved search)
  let activeOk = await setActiveInThirtyDays(page);
  if (!activeOk) {
    await delay(800);
    activeOk = await setActiveInThirtyDays(page);
  }

  // 2) Hide Profiles — must change "7 days" → "30 days" when that's the default
  let hideOk = await applyHideProfilesFilter(page);
  if (!hideOk) {
    await delay(1000);
    hideOk = await applyHideProfilesFilter(page);
  }

  await clickSearchApplyIfPresent(page);

  console.log('Naukri: waiting for filtered search results…');
  let settled = await waitForFilteredSearchResults(page, before);

  // Re-check / re-apply if verification fails OR the list fingerprint never moved
  // (Hide often sticks at "7 days" and needs a second pass).
  let verified = await verifyFiltersOnPage(page);
  if (!verified.activeOk || !verified.hideOk || !settled.changed) {
    logger.warn('Filters incomplete or list unchanged — retrying UI apply', {
      verified,
      resultsChanged: settled.changed,
    });
    if (!verified.activeOk) {
      activeOk = await setActiveInThirtyDays(page);
    }
    hideOk = await applyHideProfilesFilter(page);
    await clickSearchApplyIfPresent(page);
    await delay(1200);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    settled = await waitForFilteredSearchResults(page, before, 25_000);
    verified = await verifyFiltersOnPage(page);
  }

  activeOk = verified.activeOk;
  hideOk = verified.hideOk;

  if (!activeOk) {
    logger.warn('Naukri Resdex: Active in 30 days not confirmed on page', {
      url: page.url(),
      hint: verified.activeHint,
    });
    console.log('Naukri filter: Active in 30 days NOT confirmed');
  }
  if (!hideOk) {
    logger.warn('Naukri Resdex: Hide Profiles (downloaded/viewed / 30 days) not confirmed on page', {
      cardText: verified.cardText,
    });
    console.log(
      'Naukri filter: Hide Profiles NOT confirmed (need Downloaded/Viewed + within last 30 days)',
    );
  }

  const ok = activeOk && hideOk;
  if (ok) {
    logger.info('Filters confirmed — safe to index profiles', {
      activeOk,
      hideOk,
      resultsChanged: settled.changed,
      before: before.totalLabel,
      after: settled.afterLabel,
    });
    console.log(
      settled.changed
        ? `Naukri: filters confirmed (${before.totalLabel ?? '?'} → ${settled.afterLabel ?? 'results ready'})`
        : `Naukri: filters confirmed on page (${settled.afterLabel ?? 'results ready'}; list fingerprint unchanged)`,
    );
  } else {
    const reason = [
      !activeOk ? 'Active in 30 days not applied' : null,
      !hideOk ? 'Hide Profiles (Downloaded/Viewed within 30 days) not applied' : null,
    ]
      .filter(Boolean)
      .join('; ');
    console.log(`Naukri: refusing to index — ${reason}`);
  }

  return {
    ok,
    activeOk,
    hideOk,
    resultsChanged: settled.changed,
    reason: ok
      ? undefined
      : [
          !activeOk ? 'Active in 30 days not applied' : null,
          !hideOk ? 'Hide Profiles (Downloaded/Viewed within 30 days) not applied' : null,
        ]
          .filter(Boolean)
          .join('; '),
    beforeLabel: before.totalLabel,
    afterLabel: settled.afterLabel,
  };
}

/** Confirm the live page actually shows the filters we require. */
async function verifyFiltersOnPage(page: Page): Promise<{
  activeOk: boolean;
  hideOk: boolean;
  cardText?: string;
  activeHint?: string;
}> {
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

  // URL may stay at activeIn=23 even when the toolbar shows 30 days.
  const activeFromUrl = /activeIn=30\b/i.test(page.url());
  const activeFromUi =
    /Active in[\s\S]{0,48}30\s*days/i.test(bodyText) ||
    /Active in\s*30\s*days/i.test(bodyText);
  const activeOk = activeFromUrl || activeFromUi;

  const card = await hideProfilesCard(page);
  let cardText = '';
  let hideOk = false;
  if ((await card.count()) > 0 && (await card.isVisible().catch(() => false))) {
    cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);

    const checkbox = card.locator('input[type="checkbox"]').first();
    const checked =
      (await checkbox.count()) > 0
        ? await checkbox.isChecked().catch(() => false)
        : /hide profiles/i.test(cardText) && /profiles hidden|which have been/i.test(cardText);

    // Must be Downloaded|Viewed + within last 30 days (not 7) + Anyone/Me
    const hasAction = /\b(?:Downloaded|Viewed)\b/i.test(cardText);
    const has30Days = /within\s+last\s+30\s*days/i.test(cardText);
    const stillSevenDays = /within\s+last\s+7\s*days/i.test(cardText);
    const hasBy = /\bAnyone\b|\bMe\b/i.test(cardText);
    hideOk = Boolean(checked && hasAction && has30Days && hasBy && !stillSevenDays);
  }

  return {
    activeOk,
    hideOk,
    cardText: cardText || undefined,
    activeHint: activeFromUrl ? 'url' : activeFromUi ? 'ui' : 'missing',
  };
}

interface SearchFingerprint {
  url: string;
  totalLabel?: string;
  totalCount?: number;
  firstUniqId?: string;
}

async function readSearchFingerprint(page: Page): Promise<SearchFingerprint> {
  const url = page.url();
  let totalLabel: string | undefined;
  let totalCount: number | undefined;

  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const totalMatch = bodyText.match(
    /(\d[\d,]*)\s*(?:Resumes?|Profiles?|Candidates?|results?)\b/i,
  );
  if (totalMatch?.[1]) {
    totalLabel = totalMatch[0];
    totalCount = Number.parseInt(totalMatch[1].replace(/,/g, ''), 10);
  }

  let firstUniqId: string | undefined;
  const firstPreview = page.locator('a[href*="/preview"][href*="uniqId="]').first();
  if ((await firstPreview.count().catch(() => 0)) > 0) {
    const href = await firstPreview.getAttribute('href').catch(() => null);
    if (href) {
      try {
        firstUniqId = new URL(href, url).searchParams.get('uniqId') ?? undefined;
      } catch {
        // ignore
      }
    }
  }

  return { url, totalLabel, totalCount, firstUniqId };
}

/** Click Modify Search / Apply / Search if Resdex shows an explicit apply control. */
async function clickSearchApplyIfPresent(page: Page): Promise<boolean> {
  const labels = [
    /^Apply$/i,
    /^Apply Filters?$/i,
    /^Modify Search$/i,
    /^Search$/i,
    /^Update Search$/i,
  ];
  for (const name of labels) {
    const btn = page.getByRole('button', { name }).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click({ timeout: 8000 }).catch(() => undefined);
      logger.info('Clicked search apply control', { name: String(name) });
      await delay(600);
      return true;
    }
  }
  return false;
}

/**
 * Wait until the search result list is usable after filter changes:
 * network idle + result tuples visible, and preferably a fingerprint change.
 */
export async function waitForFilteredSearchResults(
  page: Page,
  before: SearchFingerprint,
  timeoutMs = 35_000,
): Promise<{ changed: boolean; afterLabel?: string }> {
  const deadline = Date.now() + timeoutMs;

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);

  // Ensure at least one result card / preview link is present.
  const markers = [
    'a[href*="/v3/preview"]',
    'a[href*="uniqId="]',
    '.tupleList',
    '[class*="tupleList"]',
    '[class*="tuple"]',
  ];
  for (const selector of markers) {
    const remaining = Math.max(1_000, deadline - Date.now());
    try {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: remaining });
      break;
    } catch {
      // next
    }
  }

  // Poll briefly for a list change (count or top profile). Filters often
  // reload asynchronously after the dropdown click.
  let after = await readSearchFingerprint(page);
  const isChanged = (a: SearchFingerprint, b: SearchFingerprint) =>
    (a.totalCount != null && b.totalCount != null && a.totalCount !== b.totalCount) ||
    (Boolean(a.firstUniqId) && Boolean(b.firstUniqId) && a.firstUniqId !== b.firstUniqId) ||
    (a.url !== b.url && /activeIn=30\b/i.test(b.url));

  while (Date.now() < deadline) {
    if (isChanged(before, after)) {
      logger.info('Search results changed after filters', { before, after });
      await delay(800);
      return { changed: true, afterLabel: after.totalLabel };
    }

    await delay(700);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    after = await readSearchFingerprint(page);
  }

  // Final check — uniqId can flip on the last poll after the deadline check.
  after = await readSearchFingerprint(page);
  if (isChanged(before, after)) {
    logger.info('Search results changed after filters (final check)', { before, after });
    await delay(800);
    return { changed: true, afterLabel: after.totalLabel };
  }

  logger.info('Search results settled (no fingerprint change detected)', { before, after });
  // Extra beat so late SPA paints finish before indexing.
  await delay(1200);
  return { changed: false, afterLabel: after.totalLabel };
}
