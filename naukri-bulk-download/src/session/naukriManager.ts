import type { BrowserContext } from 'playwright';
import type { AppConfig } from '../types/index.js';
import { launchBrowser } from '../browser/launcher.js';
import { performNaukriLogin } from '../auth/naukri/login.js';
import { logger } from '../utils/logger.js';
import {
  getNaukriStoragePath,
  naukriSessionExists,
  clearNaukriSession,
} from './naukriStorage.js';
import { validateNaukriSession } from './naukriValidator.js';

export interface NaukriSessionManager {
  getContext: () => BrowserContext;
  ensureValid: () => Promise<BrowserContext>;
  refresh: () => Promise<BrowserContext>;
  close: () => Promise<void>;
}

export async function createNaukriSessionManager(
  config: AppConfig,
): Promise<NaukriSessionManager> {
  let launched = await launchBrowser(config, {
    storageStatePath: (await naukriSessionExists(config))
      ? getNaukriStoragePath(config)
      : undefined,
  });
  let context = launched.context;

  const close = async () => launched.close();

  const refresh = async (): Promise<BrowserContext> => {
    logger.info('Refreshing Naukri session');
    await clearNaukriSession(config);
    await launched.close();
    launched = await launchBrowser(config);
    const result = await performNaukriLogin(launched.context, config, {
      userAgent: launched.userAgent,
    });
    if (!result.success) {
      await launched.close();
      throw new Error(result.error?.message ?? 'Naukri login failed');
    }
    context = result.context;
    return context;
  };

  const ensureValid = async (): Promise<BrowserContext> => {
    if (await naukriSessionExists(config)) {
      const validation = await validateNaukriSession(context, config);
      if (validation.valid) {
        logger.info('Reusing Naukri session');
        return context;
      }
      logger.warn('Naukri session expired', { reason: validation.reason });
    } else {
      logger.info('No Naukri session on disk');
    }
    return refresh();
  };

  return {
    getContext: () => context,
    ensureValid,
    refresh,
    close,
  };
}
