import { loadConfig, assertGoogleOAuthConfig } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { runGoogleOAuthFlow } from '../auth/google/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertGoogleOAuthConfig(config);
  getLogger(config.logLevel);

  const tokenPath = await runGoogleOAuthFlow(config);
  console.log('\n--- Google OAuth complete ---');
  console.log('Tokens saved:', tokenPath);
  process.exit(0);
}

main().catch((err) => {
  console.error('Google auth failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
