import type { BrowserContext } from 'playwright';
import type { AppConfig, PersistedSession } from '../types/index.js';
import { launchBrowser } from '../browser/launcher.js';
import { performLogin } from '../auth/login.js';
import { logger } from '../utils/logger.js';
import {
  getStorageStatePath,
  loadMetadata,
  sessionExists,
  clearSession,
} from './storage.js';
import { validateSession } from './validator.js';

export interface SessionManager {
  getContext: () => BrowserContext;
  ensureAuthenticated: () => Promise<BrowserContext>;
  refreshSession: () => Promise<BrowserContext>;
  getPersistedSession: () => Promise<PersistedSession | null>;
  close: () => Promise<void>;
}

export async function createSessionManager(
  config: AppConfig,
): Promise<SessionManager> {
  let launched = await launchBrowser(config, {
    storageStatePath:
      !config.manualResdexLogin && (await sessionExists(config))
        ? getStorageStatePath(config)
        : undefined,
  });

  let context = launched.context;

  const close = async (): Promise<void> => {
    await launched.close();
  };

  const getContext = (): BrowserContext => context;

  const refreshSession = async (): Promise<BrowserContext> => {
    if (config.manualResdexLogin) {
      logger.info('Manual Resdex mode — assuming Naukri is already logged in');
      return context;
    }

    logger.info('Refreshing session via browser login');
    await clearSession(config);
    await launched.close();

    launched = await launchBrowser(config);
    const loginResult = await performLogin(launched.context, config, {
      userAgent: launched.userAgent,
    });

    if (!loginResult.success) {
      await launched.close();
      throw new Error(
        loginResult.error?.message ?? 'Login failed during session refresh',
      );
    }

    context = loginResult.context;
    return context;
  };

  const ensureAuthenticated = async (): Promise<BrowserContext> => {
    if (config.manualResdexLogin) {
      logger.info('Assuming Naukri is logged in — skipping session validation');
      return context;
    }

    const exists = await sessionExists(config);

    if (exists) {
      logger.info('Attempting session reuse from disk');
      const validation = await validateSession(context, config);

      if (validation.valid) {
        logger.info('Reused existing session successfully');
        return context;
      }

      logger.warn('Stored session invalid, re-logging in', {
        reason: validation.reason,
      });
      return refreshSession();
    }

    logger.info('No stored session found, performing fresh login');
    return refreshSession();
  };

  const getPersistedSession = async (): Promise<PersistedSession | null> => {
    if (!(await sessionExists(config))) return null;
    const metadata = await loadMetadata(config);
    if (!metadata) return null;

    const cookies = await context.cookies();
    return {
      storageStatePath: getStorageStatePath(config),
      metadata,
      cookies,
    };
  };

  return {
    getContext,
    ensureAuthenticated,
    refreshSession,
    getPersistedSession,
    close,
  };
}
