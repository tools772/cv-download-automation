import { loadConfig, assertCredentials } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { sessionExists } from '../session/storage.js';
import { downloadTopResdexResumes } from '../resdex/index.js';
import { printRunSummary } from '../utils/runOutput.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const hasSession = await sessionExists(config);
  assertCredentials(config, hasSession);
  getLogger(config.logLevel);

  const results = await downloadTopResdexResumes(config);
  const uploaded = results.filter((r) => r.status === 'uploaded').length;
  const clicked = results.filter((r) => r.status === 'clicked').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const ok = uploaded + clicked;

  printRunSummary(results, {
    localSaveDir: config.localSaveDir,
    driveFolderId: config.uploadToDriveAfterDownload
      ? config.googleDriveFolderId
      : undefined,
  });

  // Skipped profiles (no CV attached) are not job failures.
  if (failed > 0) {
    process.exit(1);
  }
  if (ok > 0 || skipped > 0) {
    process.exit(0);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(
    'Resdex download failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
