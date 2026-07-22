import type {
  AppConfig,
  ProcessResumeResult,
  ResumeDownloadMetadata,
} from '../types/index.js';
import { ensureNaukriSession, closeNaukriSession } from '../auth/naukri/service.js';
import { ensureGoogleAuth } from '../auth/google/authService.js';
import { downloadResume } from '../downloader/resumeDownloader.js';
import { createDriveService } from '../drive/driveService.js';
import { removeTempFile } from '../storage/tempStorage.js';
import { DedupStore } from '../storage/dedupStore.js';
import { logger } from '../utils/logger.js';

export async function processResumeDownloadAndUpload(
  config: AppConfig,
  downloadUrl: string,
  metadata: ResumeDownloadMetadata,
): Promise<ProcessResumeResult> {
  const pipelineStarted = Date.now();
  let localFile: string | undefined;

  try {
    logger.info('Pipeline started', {
      candidateId: metadata.candidateId,
      url: downloadUrl,
    });

    const naukri = await ensureNaukriSession(config);
    await ensureGoogleAuth(config);

    const dedup = new DedupStore(config);
    if (config.enableDeduplication) await dedup.load();

    const downloaded = await downloadResume(
      config,
      downloadUrl,
      metadata,
      async () => {
        await naukri.refresh();
      },
    );

    localFile = downloaded.localPath;

    if (config.enableDeduplication && dedup.has(downloaded.sha256)) {
      const existing = dedup.get(downloaded.sha256);
      logger.info('Skipping duplicate resume', {
        sha256: downloaded.sha256.slice(0, 12),
        candidateId: metadata.candidateId,
      });
      await removeTempFile(localFile);
      return {
        success: true,
        sha256: downloaded.sha256,
        driveFileId: existing?.driveFileId,
        driveUrl: existing?.driveFileId
          ? `https://drive.google.com/file/d/${existing.driveFileId}/view`
          : undefined,
        skippedDuplicate: true,
      };
    }

    const drive = await createDriveService(config);
    const uploaded = await drive.uploadResume(
      downloaded.localPath,
      {
        candidateId: metadata.candidateId,
        originalFileName: downloaded.fileName,
        uploadedAt: new Date().toISOString(),
        sha256: downloaded.sha256,
      },
      downloaded.mimeType,
    );

    if (config.enableDeduplication) {
      await dedup.record(downloaded.sha256, metadata.candidateId, uploaded.fileId);
    }

    await removeTempFile(downloaded.localPath);
    localFile = undefined;

    const durationMs = Date.now() - pipelineStarted;
    logger.info('Pipeline completed', {
      candidateId: metadata.candidateId,
      driveFileId: uploaded.fileId,
      durationMs,
    });

    return {
      success: true,
      driveFileId: uploaded.fileId,
      driveUrl: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.fileId}/view`,
      sha256: downloaded.sha256,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Pipeline failed', {
      candidateId: metadata.candidateId,
      error: message,
    });
    if (localFile) await removeTempFile(localFile);
    return { success: false, error: message, localFile };
  }
}

export async function processResumeBatch(
  config: AppConfig,
  items: Array<{ url: string; metadata: ResumeDownloadMetadata }>,
): Promise<ProcessResumeResult[]> {
  const results: ProcessResumeResult[] = [];
  await ensureNaukriSession(config);
  await ensureGoogleAuth(config);

  try {
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < items.length) {
        const current = index++;
        const item = items[current]!;
        results[current] = await processResumeDownloadAndUpload(
          config,
          item.url,
          item.metadata,
        );
      }
    };

    const workers = Array.from(
      { length: Math.min(config.uploadConcurrency, items.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  } finally {
    await closeNaukriSession();
  }
}
