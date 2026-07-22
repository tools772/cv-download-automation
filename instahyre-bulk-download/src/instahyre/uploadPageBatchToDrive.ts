import fs from 'fs-extra';
import path from 'node:path';
import type { InstahyreConfig } from '../types/index.js';
import {
  isDriveUploadEnabled,
  uploadLocalResumeToDrive,
} from '../drive/uploadAfterDownload.js';
import { logger } from '../utils/logger.js';
import type { PageBatchResult } from './downloadPageBatch.js';
import { extractPageZip, listResumeFiles } from './unzipPageBatch.js';

export interface AllBatchesUploadResult {
  totalUploadedToDrive: number;
  driveUploadFailed: number;
}

interface ExtractedResume {
  filePath: string;
  pageNumber: number;
}

/** Extract all downloaded page zips, then upload every resume to Drive. */
export async function unzipAndUploadAllBatches(
  config: InstahyreConfig,
  batches: PageBatchResult[],
): Promise<AllBatchesUploadResult | null> {
  if (!isDriveUploadEnabled(config)) {
    return null;
  }

  const downloaded = batches.filter(
    (batch) => batch.status === 'downloaded' && batch.localPath,
  );
  if (downloaded.length === 0) {
    return { totalUploadedToDrive: 0, driveUploadFailed: 0 };
  }

  console.log(`\nExtracting ${downloaded.length} page batch(es)...`);

  const extractRootDir = path.join(config.localSaveDir, 'extracted');
  const allResumeFiles: ExtractedResume[] = [];

  for (const batch of downloaded) {
    const stat = await fs.stat(batch.localPath!);
    let resumeFiles: string[];

    if (stat.isDirectory()) {
      batch.extractedDir = batch.localPath;
      resumeFiles = await listResumeFiles(batch.localPath!);
    } else {
      const extractedDir = await extractPageZip(batch.localPath!, extractRootDir);
      batch.extractedDir = extractedDir;
      resumeFiles = await listResumeFiles(extractedDir);
    }

    if (resumeFiles.length === 0) {
      throw new Error(`No resume files found in batch: ${batch.localPath}`);
    }

    for (const filePath of resumeFiles) {
      allResumeFiles.push({ filePath, pageNumber: batch.pageNumber });
    }

    console.log(`[page ${batch.pageNumber}] extracted ${resumeFiles.length} resumes`);
  }

  console.log(`\nUploading ${allResumeFiles.length} resumes to Drive...`);

  let totalUploadedToDrive = 0;
  let driveUploadFailed = 0;

  for (let i = 0; i < allResumeFiles.length; i++) {
    const { filePath, pageNumber } = allResumeFiles[i]!;
    const label = `${pageNumber}-${i + 1}`;
    try {
      await uploadLocalResumeToDrive(config, filePath, label);
      totalUploadedToDrive++;
      console.log(
        `[${totalUploadedToDrive}/${allResumeFiles.length}] ${path.basename(filePath)}`,
      );
    } catch (error) {
      driveUploadFailed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Drive upload failed for extracted resume', {
        pageNumber,
        filePath,
        error: message,
      });
      console.log(`failed | ${path.basename(filePath)} | ${message}`);
    }
  }

  return {
    totalUploadedToDrive,
    driveUploadFailed,
  };
}
