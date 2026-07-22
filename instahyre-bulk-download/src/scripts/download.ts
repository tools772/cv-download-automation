import { loadConfig, assertCredentials, assertDriveUploadConfig } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { sessionExists } from '../session/storage.js';
import { downloadInstahyreCvs } from '../instahyre/index.js';
import { isDriveUploadEnabled } from '../drive/uploadAfterDownload.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const hasSession = await sessionExists(config);
  assertCredentials(config, hasSession);
  assertDriveUploadConfig(config);
  getLogger(config.logLevel);

  console.log(
    `Instahyre download | limit=${config.downloadLimit} | driveFolder=${config.googleDriveFolderId ?? '(none)'}`,
  );

  const summary = await downloadInstahyreCvs(config);
  const failed = summary.batches.filter((b) => b.status === 'failed').length;

  console.log('\n--- Summary ---');
  console.log(`Target limit: ${summary.downloadLimit}`);
  console.log(`Resumes downloaded: ${summary.totalResumesDownloaded}`);
  console.log(`Pages processed: ${summary.batches.length} | Failed pages: ${failed}`);
  console.log(`Local folder: ${config.localSaveDir}`);
  if (isDriveUploadEnabled(config)) {
    console.log(`Uploaded to Drive: ${summary.totalUploadedToDrive}`);
    if (summary.driveUploadFailed > 0) {
      console.log(`Drive upload errors: ${summary.driveUploadFailed} (files kept locally)`);
    }
    if (config.googleDriveFolderId) {
      console.log(
        `Drive folder: https://drive.google.com/drive/folders/${config.googleDriveFolderId}`,
      );
    }
  }

  process.exit(failed > 0 || summary.driveUploadFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(
    'Instahyre download failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
