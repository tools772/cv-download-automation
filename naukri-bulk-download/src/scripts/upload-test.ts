import path from 'node:path';
import fs from 'fs-extra';
import { loadConfig, assertGoogleOAuthConfig } from '../config/index.js';
import { getLogger } from '../utils/logger.js';
import { ensureGoogleAuth } from '../auth/google/index.js';
import { createDriveService } from '../drive/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  assertGoogleOAuthConfig(config);
  getLogger(config.logLevel);
  await ensureGoogleAuth(config);

  const samplePath = path.join(config.tempDownloadDir, 'upload-test-sample.txt');
  await fs.ensureDir(config.tempDownloadDir);
  await fs.writeFile(samplePath, `Upload test ${new Date().toISOString()}\n`);

  const drive = await createDriveService(config);
  const result = await drive.uploadResume(
    samplePath,
    {
      candidateId: config.testCandidateId,
      originalFileName: 'upload-test-sample.txt',
      uploadedAt: new Date().toISOString(),
    },
    'text/plain',
  );

  await fs.remove(samplePath);

  console.log('\n--- Upload test ---');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('Upload test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
