import { loadConfig } from '../config/env.js';
import { runGoogleOAuthSetup } from '../drive/googleOAuth.js';

async function main(): Promise<void> {
  const config = loadConfig({ googleAuthMode: 'oauth' });
  const tokenPath = await runGoogleOAuthSetup(config);

  console.log('\nGoogle OAuth token saved:');
  console.log(tokenPath);
  process.exit(0);
}

main().catch((error) => {
  console.error(
    'Google OAuth setup failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
