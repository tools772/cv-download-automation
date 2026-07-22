import path from 'node:path';
import fs from 'fs-extra';
import type { AppConfig } from '../types/index.js';
import type { DownloadAndUploadResult } from '../types/index.js';
import { loadConfig } from '../config/env.js';
import { createPage } from '../browser/launcher.js';
import { ensureNaukriSession } from '../auth/naukri/service.js';
import { ensureGoogleAuth } from '../auth/google/authService.js';
import {
  interceptResumeDownloadRequest,
  type InterceptedResumeRequest,
} from '../downloader/interceptResumeDownload.js';
import { replayResumeDownload } from '../downloader/replayDownload.js';
import { createDriveService } from '../drive/driveService.js';
import { ensureTempDir, buildTempFilePath, removeTempFile } from '../storage/tempStorage.js';
import { extractCandidateIdFromUrl } from '../discovery/candidateId.js';
import { sanitizeFileName } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';
import { saveScreenshot } from '../utils/screenshot.js';

let cachedConfig: AppConfig | null = null;

function getConfig(): AppConfig {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

/**
 * Full end-to-end flow:
 * 1. Reuse Playwright session
 * 2. Open preview URL
 * 3. Intercept `/jsprofile/download/resume` (dynamic params — never hardcoded)
 * 4. Replay download via axios + stream
 * 5. Upload to Google Drive
 */
export async function downloadAndUploadResume(
  previewUrl: string,
  configOverride?: AppConfig,
): Promise<DownloadAndUploadResult> {
  const config = configOverride ?? getConfig();
  let localFile: string | undefined;
  let page: Awaited<ReturnType<typeof createPage>> | undefined;

  try {
    logger.info('downloadAndUploadResume started', {
      previewUrl: previewUrl.slice(0, 120),
    });

    const naukri = await ensureNaukriSession(config);
    await ensureGoogleAuth(config);
    const context = naukri.getContext();

    page = await createPage(context);

    const intercepted = await interceptResumeDownloadRequest(
      page,
      context,
      previewUrl,
    );

    await persistInterceptDebug(config, intercepted);

    const candidateId =
      extractCandidateIdFromUrl(previewUrl) ??
      extractCandidateIdFromUrl(intercepted.url) ??
      'candidate';

    const candidateName = await readNameFromPage(page).catch(() => undefined);

    await ensureTempDir(config);
    const tempPath = buildTempFilePath(
      config,
      candidateId,
      '.pdf',
      candidateName,
    );

    const replayed = await replayResumeDownload(
      config,
      intercepted,
      context,
      tempPath,
      {
        onSessionExpired: async () => {
          await naukri.refresh();
        },
      },
    );

    localFile = replayed.localPath;
    const finalName = buildFinalFileName(candidateId, candidateName, replayed.mimeType);

    const drive = await createDriveService(config);
    logger.info('Drive upload started', { fileName: finalName });

    const uploaded = await drive.uploadResume(
      localFile,
      {
        candidateId,
        originalFileName: finalName,
        uploadedAt: new Date().toISOString(),
        sha256: replayed.sha256,
      },
      replayed.mimeType,
    );

    const savedLocalPath = localFile;
    await removeTempFile(localFile);
    localFile = undefined;

    const driveUrl =
      uploaded.webViewLink ??
      `https://drive.google.com/file/d/${uploaded.fileId}/view`;

    logger.info('downloadAndUploadResume completed', {
      driveFileId: uploaded.fileId,
      downloadUrl: intercepted.url.slice(0, 120),
    });

    return {
      success: true,
      localFile: savedLocalPath,
      driveFileId: uploaded.fileId,
      driveUrl,
      downloadUrl: intercepted.url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('downloadAndUploadResume failed', { error: message });

    if (page) {
      await saveScreenshot(page, 'download-upload-failed').catch(() => undefined);
    }

    if (localFile) await removeTempFile(localFile);

    return {
      success: false,
      error: message,
      localFile,
    };
  } finally {
    await page?.close().catch(() => undefined);
  }
}

function buildFinalFileName(
  candidateId: string,
  candidateName: string | undefined,
  mimeType: string,
): string {
  const ext =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType.includes('wordprocessingml')
        ? 'docx'
        : mimeType === 'application/msword'
          ? 'doc'
          : 'pdf';
  const label = sanitizeFileName(candidateName || candidateId);
  return `${label}.${ext}`;
}

async function readNameFromPage(
  page: Awaited<ReturnType<typeof createPage>>,
): Promise<string | undefined> {
  for (const sel of ['h1', '[class*="candidate-name"]', '[class*="profile-name"]']) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    const text = await loc.innerText({ timeout: 3000 }).catch(() => '');
    const cleaned = text.trim().split('\n')[0]?.trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

async function persistInterceptDebug(
  config: AppConfig,
  intercepted: InterceptedResumeRequest,
): Promise<void> {
  const debugPath = path.join(config.sessionDir, 'last-intercepted-request.json');
  await fs.writeJson(debugPath, intercepted, { spaces: 2 });
  logger.info('Intercepted request saved for replay/debug', { debugPath });
}

/** Close shared browser when batch is done. */
export async function shutdownDownloadSession(): Promise<void> {
  const { closeNaukriSession } = await import('../auth/naukri/service.js');
  await closeNaukriSession();
  cachedConfig = null;
}
