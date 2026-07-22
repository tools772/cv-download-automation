import type { AppConfig } from '../../types/index.js';
import { loadConfig, assertNaukriCredentials } from '../../config/env.js';
import { getLogger } from '../../utils/logger.js';
import { createNaukriSessionManager, type NaukriSessionManager } from '../../session/naukriManager.js';
import { getNaukriStoragePath } from '../../session/naukriStorage.js';

let manager: NaukriSessionManager | null = null;

export async function getNaukriSessionManager(
  config?: AppConfig,
): Promise<NaukriSessionManager> {
  const cfg = config ?? loadConfig();
  if (!manager) {
    manager = await createNaukriSessionManager(cfg);
  }
  return manager;
}

export async function ensureNaukriSession(config?: AppConfig): Promise<NaukriSessionManager> {
  const cfg = config ?? loadConfig();
  assertNaukriCredentials(cfg);
  getLogger(cfg.logLevel);
  const m = await getNaukriSessionManager(cfg);
  await m.ensureValid();
  return m;
}

export async function loginNaukri(): Promise<string> {
  const cfg = loadConfig();
  assertNaukriCredentials(cfg);
  const m = await ensureNaukriSession(cfg);
  await m.close();
  manager = null;
  return getNaukriStoragePath(cfg);
}

export async function closeNaukriSession(): Promise<void> {
  if (manager) {
    await manager.close();
    manager = null;
  }
}
