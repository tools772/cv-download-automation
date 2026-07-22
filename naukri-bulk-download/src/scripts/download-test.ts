import { loadConfig, assertNaukriCredentials } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { ensureNaukriSession, closeNaukriSession } from '../auth/naukri/index.js';
import { downloadResume } from '../downloader/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertNaukriCredentials(config);
  getLogger(config.logLevel);

  const url = config.testResumeDownloadUrl;
  if (!url) {
    throw new Error('Set TEST_RESUME_DOWNLOAD_URL in .env');
  }

  const manager = await ensureNaukriSession(config);
  try {
    const result = await downloadResume(
      config,
      url,
      {
        candidateId: config.testCandidateId,
        sourceUrl: url,
      },
      async () => {
        await manager.refresh();
      },
    );

    console.log('\n--- Download test ---');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } finally {
    await closeNaukriSession();
  }
}

main().catch((err) => {
  console.error('Download test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
