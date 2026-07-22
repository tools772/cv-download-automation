import fs from 'fs-extra';
import type { AppConfig, ResumeDownloadMetadata, ResumeDownloadResult } from '../types/index.js';
import { createNaukriApiClient } from '../api/naukriClient.js';
import { ensureTempDir, buildTempFilePath } from '../storage/tempStorage.js';
import { sha256File } from '../utils/hash.js';
import { sanitizeFileName } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { isHtmlResponse, detectResumeFormat } from './validators.js';
import { resolveResumeFileInfo } from './mimeDetector.js';

export class ResumeDownloader {
  constructor(
    private config: AppConfig,
    private onSessionExpired?: () => Promise<void>,
  ) {}

  async download(
    downloadUrl: string,
    metadata: ResumeDownloadMetadata,
  ): Promise<ResumeDownloadResult> {
    const started = Date.now();
    logger.info('Resume download started', {
      candidateId: metadata.candidateId,
      url: downloadUrl,
    });

    await ensureTempDir(this.config);
    const client = await createNaukriApiClient(this.config, {
      onSessionExpired: this.onSessionExpired,
    });

    const { data, headers, status } = await withRetry(
      () => client.downloadBinary(downloadUrl),
      {
        label: 'resume-download',
        maxAttempts: this.config.downloadMaxRetries,
        retryOn: (_err, s) => s === 429 || s === 500 || s === 502 || s === 503,
      },
    );

    if (status >= 400) {
      throw new Error(`Resume download failed with HTTP ${status}`);
    }

    if (isHtmlResponse(data)) {
      throw new Error(
        'Response was HTML (login/captcha page) — refresh Naukri session or verify URL',
      );
    }

    const format = detectResumeFormat(data);
    if (!format.valid) {
      throw new Error('Downloaded file is not a valid PDF/DOC/DOCX resume');
    }

    const contentType = headers['content-type'];
    const { mimeType, extension } = resolveResumeFileInfo(
      data,
      contentType,
      metadata.originalFileName,
    );

    const localPath = buildTempFilePath(
      this.config,
      metadata.candidateId,
      extension,
      metadata.candidateName,
    );

    await fs.writeFile(localPath, data);
    const sha256 = await sha256File(localPath);
    const stat = await fs.stat(localPath);
    const fileName =
      metadata.originalFileName ||
      `${sanitizeFileName(metadata.candidateName || metadata.candidateId)}.${extension}`;

    const durationMs = Date.now() - started;
    logger.info('Resume download completed', {
      candidateId: metadata.candidateId,
      fileName,
      mimeType,
      sizeBytes: stat.size,
      durationMs,
      sha256: sha256.slice(0, 12),
    });

    return {
      localPath,
      fileName,
      mimeType,
      sizeBytes: stat.size,
      sha256,
      durationMs,
    };
  }
}

export async function downloadResume(
  config: AppConfig,
  downloadUrl: string,
  metadata: ResumeDownloadMetadata,
  onSessionExpired?: () => Promise<void>,
): Promise<ResumeDownloadResult> {
  const downloader = new ResumeDownloader(config, onSessionExpired);
  return downloader.download(downloadUrl, metadata);
}
