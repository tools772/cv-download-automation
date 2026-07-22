import path from 'node:path';
import fs from 'fs-extra';
import type { InstahyreConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { uploadFileToDrive, type DriveUploadResult } from './googleDrive.js';

export function isDriveUploadEnabled(config: InstahyreConfig): boolean {
  return Boolean(
    config.uploadToDriveAfterDownload && config.googleDriveFolderId?.trim(),
  );
}

export async function uploadLocalResumeToDrive(
  config: InstahyreConfig,
  localPath: string,
  label: string | number,
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

  const fileName = path.basename(resolved);
  logger.info('Uploading local resume to Google Drive', {
    label,
    localPath: resolved,
    fileName,
    folderId: config.googleDriveFolderId,
  });

  const driveFile = await uploadFileToDrive(config, resolved, fileName);

  logger.info('Resume uploaded to Google Drive', {
    label,
    driveFileId: driveFile.id,
    driveLink: driveFile.webViewLink,
  });

  return driveFile;
}
