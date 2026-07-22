/**
 * Naukri Recruiter automation — library entry point.
 * Use scripts: npm run login | npm run test-api
 */
export { loadConfig, assertCredentials } from './config/index.js';
export * from './types/index.js';
export * from './browser/index.js';
export * from './auth/index.js';
export * from './session/index.js';
export * from './api/index.js';
export * from './drive/index.js';
export * from './resdex/index.js';
export * from './utils/index.js';

import { loadConfig } from './config/env.js';
import { getLogger } from './utils/logger.js';
import { createNaukriAuthService } from './auth/naukriAuth.js';
import { createRecruiterApiService } from './api/recruiterApi.js';

async function devBootstrap(): Promise<void> {
  const config = loadConfig();
  getLogger(config.logLevel);

  const auth = await createNaukriAuthService();
  const manager = await auth.login();
  const api = await createRecruiterApiService(config, {
    onSessionExpired: async () => {
      await manager.refreshSession();
    },
  });

  const result = await api.runDashboardSmokeTest();
  console.log('Dev bootstrap API result:', result);
  await auth.close();
}

const isMain =
  process.argv[1]?.includes('index') &&
  !process.argv[1]?.includes('scripts');

if (isMain) {
  devBootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
