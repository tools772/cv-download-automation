import type { Locator, Page } from 'playwright';
import { LOGIN_PLACEHOLDERS } from '../config/selectors.js';

export async function findFirstVisible(
  page: Page,
  selectors: string[],
  timeoutMs = 15_000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = resolveLocator(page, selector);
      const count = await locator.count();
      if (count === 0) continue;

      try {
        if (await locator.isVisible({ timeout: 500 })) {
          return locator;
        }
      } catch {
        // try next selector
      }
    }
    await page.waitForTimeout(300);
  }

  return null;
}

function resolveLocator(page: Page, selector: string): Locator {
  if (selector.startsWith('getByPlaceholder:')) {
    return page.getByPlaceholder(selector.slice('getByPlaceholder:'.length));
  }
  if (selector.startsWith('getByRole:')) {
    const rest = selector.slice('getByRole:'.length);
    const [role, name] = rest.split('|');
    return page.getByRole(role as Parameters<Page['getByRole']>[0], {
      name: new RegExp(name ?? '', 'i'),
    });
  }
  return page.locator(selector).first();
}

export async function fillFirstVisible(
  page: Page,
  selectors: string[],
  value: string,
  options?: { staggerMs?: [number, number] },
): Promise<Locator> {
  const field = await findFirstVisible(page, selectors);
  if (!field) {
    throw new Error(
      `Could not find visible input for selectors: ${selectors.join(', ')}`,
    );
  }

  await field.click();
  await field.fill('');
  await field.pressSequentially(value, {
    delay: options?.staggerMs
      ? Math.floor(
          (options.staggerMs[0] + options.staggerMs[1]) / 2 +
            Math.random() * (options.staggerMs[1] - options.staggerMs[0]),
        )
      : 50 + Math.floor(Math.random() * 80),
  });

  return field;
}

export async function fillByPlaceholder(
  page: Page,
  placeholder: string,
  value: string,
  options?: { staggerMs?: [number, number] },
): Promise<Locator> {
  const field = page.getByPlaceholder(placeholder, { exact: true });
  await field.waitFor({ state: 'visible', timeout: 20_000 });
  await field.click();
  await field.fill('');
  await field.pressSequentially(value, {
    delay: options?.staggerMs
      ? Math.floor(
          (options.staggerMs[0] + options.staggerMs[1]) / 2 +
            Math.random() * (options.staggerMs[1] - options.staggerMs[0]),
        )
      : 50 + Math.floor(Math.random() * 80),
  });
  return field;
}

/** Fill recruit/login form using known placeholders, with selector fallback. */
export async function fillRecruitLoginField(
  page: Page,
  kind: 'email' | 'password',
  value: string,
  fallbackSelectors: string[],
  options?: { staggerMs?: [number, number] },
): Promise<Locator> {
  const placeholder =
    kind === 'email'
      ? LOGIN_PLACEHOLDERS.email
      : LOGIN_PLACEHOLDERS.password;

  try {
    return await fillByPlaceholder(page, placeholder, value, options);
  } catch {
    return fillFirstVisible(page, fallbackSelectors, value, options);
  }
}

export async function clickFirstVisible(
  page: Page,
  selectors: string[],
): Promise<void> {
  const button = await findFirstVisible(page, selectors);
  if (!button) {
    throw new Error(
      `Could not find visible button for selectors: ${selectors.join(', ')}`,
    );
  }
  await button.click();
}

export async function clickLogInButton(page: Page, selectors: string[]): Promise<void> {
  try {
    const btn = page.getByRole('button', { name: /^Log in$/i });
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
    await btn.click();
    return;
  } catch {
    await clickFirstVisible(page, selectors);
  }
}
