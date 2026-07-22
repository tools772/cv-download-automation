import fs from 'fs-extra';
import { google } from 'googleapis';
import type { AppConfig, DriveUploadMetadata, DriveUploadResult } from '../types/index.js';
import { getAuthorizedOAuth2Client } from '../auth/google/authService.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { DriveFolderCache, dailyFolderKey } from './folderCache.js';

export class GoogleDriveService {
  private cache: DriveFolderCache;

  constructor(private config: AppConfig) {
    this.cache = new DriveFolderCache(config);
  }

  async init(): Promise<void> {
    await this.cache.load();
  }

  private async getDrive() {
    const auth = await getAuthorizedOAuth2Client(this.config);
    return google.drive({ version: 'v3', auth });
  }

  async ensureFolder(folderPath: string): Promise<string> {
    const cached = this.cache.get(folderPath);
    if (cached) return cached;

    const drive = await this.getDrive();
    const parts = folderPath.split('/').filter(Boolean);
    let parentId = this.config.googleDriveParentId ?? 'root';

    for (const part of parts) {
      const cacheKey = `${parentId}/${part}`;
      const hit = this.cache.get(cacheKey);
      if (hit) {
        parentId = hit;
        continue;
      }

      const list = await drive.files.list({
        q: `'${parentId}' in parents and name='${part.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
        pageSize: 1,
      });

      if (list.data.files?.[0]?.id) {
        parentId = list.data.files[0].id!;
      } else {
        const created = await drive.files.create({
          requestBody: {
            name: part,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          },
          fields: 'id',
        });
        parentId = created.data.id!;
        logger.info('Drive folder created', { name: part, folderId: parentId });
      }

      await this.cache.set(cacheKey, parentId);
    }

    await this.cache.set(folderPath, parentId);
    return parentId;
  }

  /** Resolve target folder: fixed ID, date subfolder inside fixed ID, or auto-created path. */
  async resolveUploadFolderId(): Promise<string> {
    const fixedId = this.config.googleDriveFolderId;
    if (fixedId) {
      if (this.config.googleDriveUseDateSubfolder) {
        const subPath = new Date().toISOString().slice(0, 10);
        return this.ensureFolderUnderParent(fixedId, subPath);
      }
      logger.info('Using fixed Google Drive folder', { folderId: fixedId });
      return fixedId;
    }

    const folderPath = dailyFolderKey(this.config.googleDriveFolder);
    return this.ensureFolder(folderPath);
  }

  async ensureFolderUnderParent(parentId: string, folderName: string): Promise<string> {
    const cacheKey = `${parentId}/${folderName}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const drive = await this.getDrive();
    const list = await drive.files.list({
      q: `'${parentId}' in parents and name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });

    let folderId = list.data.files?.[0]?.id;
    if (!folderId) {
      const created = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      });
      folderId = created.data.id!;
      logger.info('Drive date subfolder created', { folderName, folderId, parentId });
    }

    await this.cache.set(cacheKey, folderId);
    return folderId;
  }

  async uploadResume(
    localPath: string,
    metadata: DriveUploadMetadata,
    mimeType: string,
  ): Promise<DriveUploadResult> {
    const started = Date.now();
    const folderId = await this.resolveUploadFolderId();
    const drive = await this.getDrive();
    const fileName = metadata.originalFileName;

    logger.info('Drive upload started', {
      candidateId: metadata.candidateId,
      fileName,
      folderId,
    });

    const result = await withRetry(
      async () => {
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [folderId],
            description: JSON.stringify({
              candidateId: metadata.candidateId,
              uploadedAt: metadata.uploadedAt,
              sha256: metadata.sha256,
            }),
          },
          media: {
            mimeType,
            body: fs.createReadStream(localPath),
          },
          fields: 'id,name,mimeType,webViewLink,webContentLink',
          supportsAllDrives: true,
        });
        return res.data;
      },
      { label: 'drive-upload', maxAttempts: 3 },
    );

    const durationMs = Date.now() - started;
    logger.info('Drive upload completed', {
      candidateId: metadata.candidateId,
      fileId: result.id,
      durationMs,
    });

    return {
      fileId: result.id!,
      name: result.name ?? fileName,
      mimeType: result.mimeType ?? mimeType,
      webViewLink: result.webViewLink ?? undefined,
      webContentLink: result.webContentLink ?? undefined,
      folderId,
    };
  }
}

export async function createDriveService(config: AppConfig): Promise<GoogleDriveService> {
  const service = new GoogleDriveService(config);
  await service.init();
  return service;
}
