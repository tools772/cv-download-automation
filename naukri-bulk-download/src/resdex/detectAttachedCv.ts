import type { Frame, Page } from 'playwright';
import { delay } from '../utils/delay.js';

/** Thrown when Attached CV tab has no resume to download — profile is skipped immediately. */
export class NoAttachedCvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAttachedCvError';
  }
}

const NO_CV_TEXT_PATTERNS: RegExp[] = [
  /no\s+cv\s+attached/i,
  /cv\s+not\s+attached/i,
  /no\s+resume\s+attached/i,
  /resume\s+not\s+attached/i,
  /no\s+document\s+attached/i,
  /cv\s+not\s+available/i,
  /resume\s+not\s+available/i,
  /no\s+attachment\s+found/i,
  /candidate\s+has\s+not\s+uploaded/i,
  /hasn'?t\s+uploaded\s+(a\s+)?cv/i,
  /not\s+uploaded\s+(any\s+)?cv/i,
];

const DOWNLOAD_CONTROL_SELECTORS = [
  'button:has-text("Download CV")',
  '[role="button"]:has-text("Download CV")',
  'a:has-text("Download CV")',
  'button[aria-label*="download" i]',
  '[class*="downloadIcon"]',
  '[class*="download-icon"]',
  'a[download]',
];

const VIEW_CV_SELECTORS = [
  'button:has-text("View CV")',
  '[role="button"]:has-text("View CV")',
  'a:has-text("View CV")',
  'button:has-text("View Resume")',
];

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

function collectActiveFrames(page: Page): Frame[] {
  return page.frames().filter((f) => !f.isDetached());
}

async function isAnyVisible(
  frame: Frame,
  selectors: string[],
  timeoutMs = 500,
): Promise<boolean> {
  for (const selector of selectors) {
    const loc = frame.locator(selector).first();
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function findNoCvMessage(page: Page): Promise<string | null> {
  for (const frame of collectActiveFrames(page)) {
    for (const pattern of NO_CV_TEXT_PATTERNS) {
      try {
        const el = frame.getByText(pattern).first();
        if (await el.isVisible({ timeout: 500 })) {
          const text = (await el.innerText({ timeout: 500 }).catch(() => '')).trim();
          return text || pattern.source;
        }
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function hasAttachedCvActions(page: Page): Promise<boolean> {
  for (const frame of collectActiveFrames(page)) {
    if (await isAnyVisible(frame, DOWNLOAD_CONTROL_SELECTORS, 400)) {
      return true;
    }
    if (await isAnyVisible(frame, VIEW_CV_SELECTORS, 400)) {
      return true;
    }
  }
  return false;
}

/**
 * Fast check on the Attached CV tab — call right after opening that tab.
 * Throws NoAttachedCvError when there is nothing to download.
 */
export async function assertAttachedCvAvailable(page: Page): Promise<void> {

  // Check for captcha before declaring no CV
  const hasCaptcha = await isCaptchaPresent(page);
  if (hasCaptcha) {
    // Throw a specific error so processProfile can handle it
    throw new Error('__captcha__');
  }
  
  await delay(350);

  const emptyMessage = await findNoCvMessage(page);
  if (emptyMessage) {
    throw new NoAttachedCvError(emptyMessage);
  }

  if (await hasAttachedCvActions(page)) {
    return;
  }

  throw new NoAttachedCvError(
    'No Download CV or View CV control found on Attached CV tab',
  );
}

/** Quick check when Attached CV tab cannot be opened (avoids long download timeouts). */
export async function getSkipReasonIfNoCvOnProfile(
  page: Page,
): Promise<string | null> {
  await delay(200);
  const emptyMessage = await findNoCvMessage(page);
  if (emptyMessage) return emptyMessage;
  if (!(await hasAttachedCvActions(page))) {
    return 'No Attached CV tab or download actions on profile';
  }
  return null;
}
