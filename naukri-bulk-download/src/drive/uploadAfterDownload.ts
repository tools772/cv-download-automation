import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { uploadFileToDrive, type DriveUploadResult } from './googleDrive.js';

export function isDriveUploadEnabled(config: AppConfig): boolean {
  return Boolean(
    config.uploadToDriveAfterDownload &&
      config.googleDriveFolderId?.trim(),
  );
}

/**
 * Upload a file that was already saved locally by the download step.
 * Does not interact with the browser or download flow.
 */
export async function uploadLocalResumeToDrive(
  config: AppConfig,
  localPath: string,
  rank: number,
): Promise<DriveUploadResult> {
  if (!config.googleDriveFolderId) {
    throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID for Drive upload.');
  }

  const resolved = path.resolve(localPath);
  if (!(await fs.pathExists(resolved))) {
    throw new Error(`Local resume file not found: ${resolved}`);
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${resolved}`);
  }

  const fileName = driveResumeFileName(path.basename(resolved));
  logger.info('Uploading local resume to Google Drive', {
    rank,
    localPath: resolved,
    fileName,
    folderId: config.googleDriveFolderId,
  });

  const driveFile = await uploadFileToDrive(config, resolved, fileName);

  logger.info('Resume uploaded to Google Drive', {
    rank,
    driveFileId: driveFile.id,
    driveLink: driveFile.webViewLink,
  });

  return driveFile;
}

/** Strip rank prefix so Drive dedupes "01-Rohith-B.pdf" and "02-Rohith-B.pdf" as the same person. */
function driveResumeFileName(localBaseName: string): string {
  return localBaseName.replace(/^\d+[-_]\s*/, '') || localBaseName;
}
