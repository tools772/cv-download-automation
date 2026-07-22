import { loadConfig, assertNaukriCredentials } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { loginNaukri } from '../auth/naukri/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertNaukriCredentials(config);
  getLogger(config.logLevel);

  const storagePath = await loginNaukri();
  console.log('\n--- Naukri login complete ---');
  console.log('Storage state:', storagePath);
  process.exit(0);
}

main().catch((err) => {
  console.error('Login failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
