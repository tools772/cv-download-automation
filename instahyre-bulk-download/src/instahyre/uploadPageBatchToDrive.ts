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

function resumeIdentityKey(filePath: string): string {
  return path.basename(filePath).trim().toLowerCase();
}

/**
 * Extract downloaded page zips, then upload resumes to Drive.
 * Caps uploads to `maxUploads` (download limit) and skips duplicate filenames
 * within the same fetch — Instahyre zip downloads often include more PDFs than
 * were selected.
 */
export async function unzipAndUploadAllBatches(
  config: InstahyreConfig,
  batches: PageBatchResult[],
  maxUploads?: number,
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

  const uploadCap =
    typeof maxUploads === 'number' && maxUploads > 0
      ? maxUploads
      : Number.POSITIVE_INFINITY;

  console.log(`\nExtracting ${downloaded.length} page batch(es)...`);

  const extractRootDir = path.join(config.localSaveDir, 'extracted');
  const allResumeFiles: ExtractedResume[] = [];
  const seenNames = new Set<string>();
  let skippedDuplicates = 0;

  for (const batch of downloaded) {
    if (allResumeFiles.length >= uploadCap) break;

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

    let kept = 0;
    for (const filePath of resumeFiles) {
      if (allResumeFiles.length >= uploadCap) break;
      const key = resumeIdentityKey(filePath);
      if (seenNames.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      seenNames.add(key);
      allResumeFiles.push({ filePath, pageNumber: batch.pageNumber });
      kept += 1;
    }

    console.log(
      `[page ${batch.pageNumber}] extracted ${resumeFiles.length} resumes` +
        (kept !== resumeFiles.length ? ` (kept ${kept} unique/within limit)` : ''),
    );
  }

  if (skippedDuplicates > 0) {
    logger.info('Skipped duplicate resume filenames within fetch', {
      skippedDuplicates,
    });
    console.log(`Skipped ${skippedDuplicates} duplicate filename(s) in zip`);
  }

  if (
    Number.isFinite(uploadCap) &&
    allResumeFiles.length < (batches.reduce((n, b) => n + (b.resumeCount || 0), 0) || 0)
  ) {
    logger.info('Capping Instahyre uploads to requested limit', {
      uploadCap,
      queued: allResumeFiles.length,
    });
  }

  console.log(
    `\nUploading ${allResumeFiles.length} resumes to Drive` +
      (Number.isFinite(uploadCap) ? ` (cap ${uploadCap})` : '') +
      '...',
  );

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
