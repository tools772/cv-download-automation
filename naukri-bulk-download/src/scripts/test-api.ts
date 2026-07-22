import { loadConfig, assertCredentials } from '../config/env.js';
import { getLogger, logger } from '../utils/logger.js';
import { quickLogin } from '../auth/naukriAuth.js';
import { createRecruiterApiService } from '../api/recruiterApi.js';
import { createAuthenticatedClient } from '../api/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertCredentials(config);
  getLogger(config.logLevel);

  const { manager } = await quickLogin();

  const api = await createRecruiterApiService(config, {
    maxRetries: 2,
    onSessionExpired: async () => {
      logger.warn('API detected expired session — refreshing via browser');
      await manager.refreshSession();
    },
  });

  const result = await api.runDashboardSmokeTest();

  console.log('\n--- Recruiter API smoke test ---');
  console.log('Status:', result.status);
  console.log('Response size (bytes):', result.responseSize);
  console.log('User info:', JSON.stringify(result.userInfo ?? {}, null, 2));

  const client = await createAuthenticatedClient(config, {
    onSessionExpired: async () => {
      await manager.refreshSession();
    },
  });
  const profileRes = await client.get('/mnr/api/user/profile').catch(() => null);
  if (profileRes) {
    logger.info('Profile endpoint probe', {
      status: profileRes.status,
      size: JSON.stringify(profileRes.data ?? '').length,
    });
  }

  await manager.close();
  process.exit(result.status >= 200 && result.status < 500 ? 0 : 1);
}

main().catch((error) => {
  console.error('API test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
