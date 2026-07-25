import { loadConfig, assertCredentials, assertDriveUploadConfig } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { sessionExists } from '../session/storage.js';
import { downloadInstahyreCvs } from '../instahyre/index.js';
import { isDriveUploadEnabled } from '../drive/uploadAfterDownload.js';
import { printInstahyreError } from '../instahyre/userErrors.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const hasSession = await sessionExists(config);
  assertCredentials(config, hasSession);
  assertDriveUploadConfig(config);
  getLogger(config.logLevel);

  console.log(
    `Instahyre download | url=${config.instahyreCandidatesUrl ?? '(missing)'} | limit=${config.downloadLimit} | driveFolder=${config.googleDriveFolderId ?? '(none)'}`,
  );

  const summary = await downloadInstahyreCvs(config);
  const failed = summary.batches.filter((b) => b.status === 'failed').length;

  if (summary.totalResumesDownloaded === 0) {
    const lastErr = summary.batches.find((b) => b.error)?.error;
    printInstahyreError(
      lastErr ??
        'No CVs were downloaded. Leave the browser open and confirm the Instahyre candidates URL is correct.',
    );
    process.exit(1);
  }

  console.log('\n--- Summary ---');
  console.log(`Target limit: ${summary.downloadLimit}`);
  const discovered = summary.resultsTotal ?? summary.totalResumesDownloaded;
  console.log(`totalDiscovered=${discovered}`);
  console.log(`totalResumesDownloaded=${summary.totalResumesDownloaded}`);
  console.log(`totalSuccess=${summary.totalUploadedToDrive}`);
  console.log(`totalSkipped=0`);
  console.log(`totalFailed=${failed + summary.driveUploadFailed}`);
  console.log(`Resumes downloaded: ${summary.totalResumesDownloaded}`);
  console.log(`Pages processed: ${summary.batches.length} | Failed pages: ${failed}`);
  console.log(`Local folder: ${config.localSaveDir}`);
  if (isDriveUploadEnabled(config)) {
    console.log(`totalUploadedToDrive=${summary.totalUploadedToDrive}`);
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
  const message = error instanceof Error ? error.message : String(error);
  printInstahyreError(message);
  console.error(`Instahyre download failed: ${message}`);
  process.exit(1);
});
