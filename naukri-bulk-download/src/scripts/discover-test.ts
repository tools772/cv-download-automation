import { loadConfig, assertNaukriCredentials } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { resolveDiscoveredBatch } from '../pipeline/resolveCandidate.js';
import { closeNaukriSession } from '../auth/naukri/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertNaukriCredentials(config);
  getLogger(config.logLevel);

  if (!config.resdexSavedSearchUrl) {
    throw new Error('Set RESDEX_SAVED_SEARCH_URL in .env');
  }

  const candidates = await resolveDiscoveredBatch(config);
  await closeNaukriSession();

  console.log('\n--- Discovery test ---');
  console.log(JSON.stringify(candidates, null, 2));
  process.exit(candidates.length > 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Discovery failed:', err instanceof Error ? err.message : err);
  await closeNaukriSession().catch(() => undefined);
  process.exit(1);
});
