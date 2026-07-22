import { loadConfig, assertCredentials } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { quickLogin } from '../auth/naukriAuth.js';
async function main(): Promise<void> {
  const config = loadConfig();
  assertCredentials(config);
  getLogger(config.logLevel);

  const { manager, storageStatePath } = await quickLogin();
  const session = await manager.getPersistedSession();

  console.log('\n--- Login complete ---');
  console.log('Storage state:', storageStatePath);
  console.log('Cookies saved:', session?.cookies.length ?? 0);
  console.log('Metadata:', session?.metadata ?? 'n/a');

  await manager.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Login failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
