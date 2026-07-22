import path from 'node:path';
import fs from 'fs-extra';
import type { BrowserContext, Page } from 'playwright';
import type { AppConfig, SessionMetadata, StorageSnapshot } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function getStorageStatePath(config: AppConfig): string {
  return path.join(config.sessionDir, config.storageStateFile);
}

export function getMetadataPath(config: AppConfig): string {
  return path.join(config.sessionDir, 'metadata.json');
}

export async function ensureSessionDir(config: AppConfig): Promise<void> {
  await fs.ensureDir(config.sessionDir);
}

export async function sessionExists(config: AppConfig): Promise<boolean> {
  const statePath = getStorageStatePath(config);
  return fs.pathExists(statePath);
}

export async function saveStorageState(
  context: BrowserContext,
  config: AppConfig,
  metadata: Omit<SessionMetadata, 'savedAt'>,
): Promise<string> {
  await ensureSessionDir(config);
  const statePath = getStorageStatePath(config);
  await context.storageState({ path: statePath });

  const fullMetadata: SessionMetadata = {
    ...metadata,
    savedAt: new Date().toISOString(),
  };
  await fs.writeJson(getMetadataPath(config), fullMetadata, { spaces: 2 });

  logger.info('Session persisted to disk', {
    statePath,
    cookieCount: (await context.cookies()).length,
  });

  return statePath;
}

export async function loadMetadata(
  config: AppConfig,
): Promise<SessionMetadata | null> {
  const metaPath = getMetadataPath(config);
  if (!(await fs.pathExists(metaPath))) return null;
  return (await fs.readJson(metaPath)) as SessionMetadata;
}

export async function captureWebStorage(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(`(() => {
    const readStorage = (storage) => {
      const out = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) out[key] = storage.getItem(key) ?? '';
      }
      return out;
    };

    const href = document.location.href;
    return {
      localStorage: { [href]: readStorage(localStorage) },
      sessionStorage: { [href]: readStorage(sessionStorage) },
    };
  })()`) as Promise<StorageSnapshot>;
}

export async function saveWebStorageSnapshot(
  page: Page,
  config: AppConfig,
): Promise<void> {
  const snapshot = await captureWebStorage(page);
  const outPath = path.join(config.sessionDir, 'webStorage.json');
  await fs.writeJson(outPath, snapshot, { spaces: 2 });
  logger.info('Web storage snapshot saved', { outPath });
}

export async function persistContextSession(
  context: BrowserContext,
  config: AppConfig,
  meta: {
    username: string;
    loginUrl: string;
    userAgent: string;
    dashboardUrl?: string;
  },
): Promise<void> {
  const pages = context.pages();
  const page = pages[0];
  if (page) {
    await saveWebStorageSnapshot(page, config);
  }

  await saveStorageState(context, config, {
    username: meta.username,
    loginUrl: meta.loginUrl,
    dashboardUrl: meta.dashboardUrl,
    userAgent: meta.userAgent,
  });
}

interface StorageStateFile {
  cookies?: Awaited<ReturnType<BrowserContext['cookies']>>;
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/** Restore cookies/localStorage from a Playwright storageState JSON into an existing context. */
export async function applyStorageStateFile(
  context: BrowserContext,
  storageStatePath: string,
): Promise<void> {
  if (!(await fs.pathExists(storageStatePath))) return;

  const state = (await fs.readJson(storageStatePath)) as StorageStateFile;
  if (state.cookies?.length) {
    await context.addCookies(state.cookies);
  }

  for (const originState of state.origins ?? []) {
    const page = await context.newPage();
    try {
      await page.goto(originState.origin, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await page.evaluate((items) => {
        for (const { name, value } of items) {
          localStorage.setItem(name, value);
        }
      }, originState.localStorage);
    } catch {
      // origin may be unreachable; cookies may still be enough
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  logger.info('Applied storage state to browser context', { storageStatePath });
}

export async function clearSession(config: AppConfig): Promise<void> {
  const statePath = getStorageStatePath(config);
  const metaPath = getMetadataPath(config);
  const webStoragePath = path.join(config.sessionDir, 'webStorage.json');

  await Promise.all([
    fs.remove(statePath).catch(() => undefined),
    fs.remove(metaPath).catch(() => undefined),
    fs.remove(webStoragePath).catch(() => undefined),
  ]);
  logger.info('Session files cleared');
}
