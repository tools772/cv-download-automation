import type { Cookie } from 'playwright';
import type { AppConfig } from '../types/index.js';
import fs from 'fs-extra';
import { getStorageStatePath } from '../session/storage.js';

interface StorageStateFile {
  cookies: Cookie[];
  origins?: unknown[];
}

export async function loadCookiesFromStorage(
  config: AppConfig,
): Promise<Cookie[]> {
  const statePath = getStorageStatePath(config);
  if (!(await fs.pathExists(statePath))) {
    return [];
  }

  const state = (await fs.readJson(statePath)) as StorageStateFile;
  return state.cookies ?? [];
}

export function cookiesToHeader(cookies: Cookie[]): string {
  return cookies
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function filterCookiesForUrl(
  cookies: Cookie[],
  url: string,
): Cookie[] {
  try {
    const hostname = new URL(url).hostname;
    return cookies.filter((cookie) => {
      const domain = cookie.domain.startsWith('.')
        ? cookie.domain.slice(1)
        : cookie.domain;
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return cookies;
  }
}
