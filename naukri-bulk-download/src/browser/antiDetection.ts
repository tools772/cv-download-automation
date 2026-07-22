import type { BrowserContext, Page } from 'playwright';
import { randomInt } from '../utils/delay.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

export function pickUserAgent(): string {
  return USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)]!;
}

export function randomViewport(): { width: number; height: number } {
  return {
    width: randomInt(1280, 1920),
    height: randomInt(720, 1080),
  };
}

export const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
  window.chrome = window.chrome || { runtime: {} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
})();
`;

export async function applyAntiDetection(
  context: BrowserContext,
  page?: Page,
): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  if (page) {
    await page.addInitScript(STEALTH_INIT_SCRIPT);
  }
}

export function getChromiumArgs(): string[] {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
  ];
}
