import { loadConfig, assertNaukriCredentials, assertGoogleOAuthConfig } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import {
  downloadAndUploadResume,
  shutdownDownloadSession,
} from '../pipeline/downloadAndUploadResume.js';
import { resolvePreviewUrl } from '../pipeline/resolvePreviewUrl.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertNaukriCredentials(config);
  assertGoogleOAuthConfig(config);
  getLogger(config.logLevel);

  const previewUrl = await resolvePreviewUrl(config);

  console.log('\n--- Preview URL ---');
  console.log(previewUrl);

  const result = await downloadAndUploadResume(previewUrl, config);

  await shutdownDownloadSession();

  console.log('\n--- downloadAndUploadResume result ---');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Process test failed:', err instanceof Error ? err.message : err);
  await shutdownDownloadSession().catch(() => undefined);
  process.exit(1);
});
