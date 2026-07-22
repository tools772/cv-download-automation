import { loadConfig } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { runManualLoginSession } from '../auth/login.js';

async function main(): Promise<void> {
  const config = loadConfig({ headless: false, manualLogin: true });
  getLogger(config.logLevel);

  console.log('Opening Instahyre for manual login…');
  console.log(`Session will be saved to: ${config.sessionDir}/${config.storageStateFile}\n`);

  await runManualLoginSession(config);

  console.log('\nDone. You can now run Instahyre fetch (headless is OK once session is saved).');
}

main().catch((error) => {
  console.error(
    'Instahyre login failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
