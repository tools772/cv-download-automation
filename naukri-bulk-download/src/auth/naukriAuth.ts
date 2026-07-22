import type { AppConfig } from '../types/index.js';
import { assertCredentials, loadConfig } from '../config/env.js';
import { createSessionManager } from '../session/manager.js';
import { getStorageStatePath } from '../session/storage.js';
import { getLogger } from '../utils/logger.js';
import type { SessionManager } from '../session/manager.js';

export interface NaukriAuthService {
  login: () => Promise<SessionManager>;
  getSessionManager: () => Promise<SessionManager>;
  close: () => Promise<void>;
}

let activeManager: SessionManager | null = null;

export async function createNaukriAuthService(
  configOverrides: Partial<AppConfig> = {},
): Promise<NaukriAuthService> {
  const config = loadConfig(configOverrides);
  initLogger(config);

  const close = async (): Promise<void> => {
    if (activeManager) {
      await activeManager.close();
      activeManager = null;
    }
  };

  const getSessionManager = async (): Promise<SessionManager> => {
    if (activeManager) return activeManager;
    activeManager = await createSessionManager(config);
    return activeManager;
  };

  const login = async (): Promise<SessionManager> => {
    assertCredentials(config);
    const manager = await getSessionManager();
    await manager.ensureAuthenticated();
    return manager;
  };

  return { login, getSessionManager, close };
}

function initLogger(config: AppConfig): void {
  getLogger(config.logLevel);
}

export async function quickLogin(): Promise<{
  config: AppConfig;
  manager: SessionManager;
  storageStatePath: string;
}> {
  const config = loadConfig();
  assertCredentials(config);

  const manager = await createSessionManager(config);
  activeManager = manager;

  await manager.ensureAuthenticated();

  return {
    config,
    manager,
    storageStatePath: getStorageStatePath(config),
  };
}

// Re-export for scripts
export { loadConfig, assertCredentials };
