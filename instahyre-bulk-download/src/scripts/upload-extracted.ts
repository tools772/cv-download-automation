import path from 'node:path';
import fs from 'fs-extra';
import {
  assertDriveUploadConfig,
  loadConfig,
} from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import {
  isDriveUploadEnabled,
  uploadLocalResumeToDrive,
} from '../drive/uploadAfterDownload.js';
import { listResumeFiles } from '../instahyre/unzipPageBatch.js';

async function main(): Promise<void> {
  const config = loadConfig();
  getLogger(config.logLevel);
  assertDriveUploadConfig(config);

  if (!isDriveUploadEnabled(config)) {
    throw new Error(
      'Drive upload is disabled. Set UPLOAD_TO_DRIVE_AFTER_DOWNLOAD=true and GOOGLE_DRIVE_FOLDER_ID.',
    );
  }

  const extractRoot = path.join(config.localSaveDir, 'extracted');
  if (!(await fs.pathExists(extractRoot))) {
    throw new Error(`No extracted folder found: ${extractRoot}`);
  }

  const resumeFiles = await listResumeFiles(extractRoot);
  if (resumeFiles.length === 0) {
    throw new Error(`No resume files found under ${extractRoot}`);
  }

  console.log(`Uploading ${resumeFiles.length} extracted resumes to Drive...`);

  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < resumeFiles.length; i++) {
    const filePath = resumeFiles[i]!;
    try {
      await uploadLocalResumeToDrive(config, filePath, i + 1);
      uploaded++;
      console.log(`[${uploaded}/${resumeFiles.length}] ${path.basename(filePath)}`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`failed | ${path.basename(filePath)} | ${message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Uploaded: ${uploaded} | Failed: ${failed}`);
  if (config.googleDriveFolderId) {
    console.log(
      `Drive folder: https://drive.google.com/drive/folders/${config.googleDriveFolderId}`,
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(
    'Upload extracted resumes failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
