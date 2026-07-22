import fs from 'fs-extra';
import type { InstahyreConfig } from '../types/index.js';
import { launchBrowser, createPage } from '../browser/launcher.js';
import { openCandidatesPage } from '../auth/login.js';
import {
  downloadCurrentPageBatch,
  parseResultsTotal,
  type PageBatchResult,
} from './downloadPageBatch.js';
import { goToNextCandidatesPage } from './pagination.js';
import { unzipAndUploadAllBatches } from './uploadPageBatchToDrive.js';
import { isDriveUploadEnabled } from '../drive/uploadAfterDownload.js';
import { ensureSessionDir, getStorageStatePath, sessionExists } from '../session/storage.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

export interface InstahyreDownloadSummary {
  batches: PageBatchResult[];
  totalResumesDownloaded: number;
  totalUploadedToDrive: number;
  driveUploadFailed: number;
  downloadLimit: number;
  resultsTotal: number | null;
}

function isBrowserClosedError(message: string | undefined): boolean {
  return Boolean(
    message &&
      /target page, context or browser has been closed|browser tab closed/i.test(message),
  );
}

async function openDownloadSession(
  config: InstahyreConfig,
  storageStatePath: string | undefined,
) {
  const launched = await launchBrowser(config, { storageStatePath });
  const page = await createPage(launched.context);
  await openCandidatesPage(page, config);
  const resultsTotal = await parseResultsTotal(page);
  return { launched, page, resultsTotal };
}

/**
 * Page-wise bulk download: select candidates → Download resumes → Zip → next page.
 * Selects all 30 on full pages; on the last batch selects only the remaining count.
 * Drive upload runs after all pages are downloaded.
 */
export async function downloadInstahyreCvs(
  config: InstahyreConfig,
): Promise<InstahyreDownloadSummary> {
  if (!config.instahyreCandidatesUrl) {
    throw new Error('Missing INSTAHYRE_CANDIDATES_URL in .env');
  }

  await ensureSessionDir(config);
  await fs.ensureDir(config.localSaveDir);

  const storageStatePath = (await sessionExists(config))
    ? getStorageStatePath(config)
    : undefined;

  let launched = await launchBrowser(config, { storageStatePath });
  const batches: PageBatchResult[] = [];
  let totalResumesDownloaded = 0;
  let totalUploadedToDrive = 0;
  let driveUploadFailed = 0;
  let pageNumber = 1;
  let resultsTotal: number | null = null;
  let canRetryAfterBrowserClose = true;

  try {
    let page = await createPage(launched.context);
    await openCandidatesPage(page, config);
    resultsTotal = await parseResultsTotal(page);

    logger.info('Starting Instahyre page-wise download', {
      limit: config.downloadLimit,
      resultsTotal,
      localSaveDir: config.localSaveDir,
      driveUpload: isDriveUploadEnabled(config),
      headless: config.headless,
    });

    while (totalResumesDownloaded < config.downloadLimit) {
      const remaining = config.downloadLimit - totalResumesDownloaded;
      console.log(
        `[page ${pageNumber}] downloading batch (target ${config.downloadLimit}, have ${totalResumesDownloaded}, need ${remaining})`,
      );

      let batch = await downloadCurrentPageBatch(page, config, pageNumber, remaining);

      if (
        batch.status === 'failed' &&
        canRetryAfterBrowserClose &&
        isBrowserClosedError(batch.error)
      ) {
        canRetryAfterBrowserClose = false;
        logger.warn('Browser closed during download — relaunching once and retrying page', {
          pageNumber,
        });
        console.log(`[page ${pageNumber}] browser closed — relaunching and retrying once...`);

        await launched.close().catch(() => undefined);
        const session = await openDownloadSession(config, storageStatePath);
        launched = session.launched;
        page = session.page;
        resultsTotal = session.resultsTotal ?? resultsTotal;
        batch = await downloadCurrentPageBatch(page, config, pageNumber, remaining);
      }

      batches.push(batch);

      if (batch.status === 'downloaded') {
        totalResumesDownloaded += batch.resumeCount;
        console.log(
          `[page ${pageNumber}] status=downloaded | count=${batch.resumeCount} | local=${batch.localPath}`,
        );
      } else {
        console.log(`[page ${pageNumber}] status=failed | ${batch.error}`);
        break;
      }

      if (totalResumesDownloaded >= config.downloadLimit) {
        break;
      }

      console.log(`[page ${pageNumber}] navigating to next page...`);
      const hasNext = await goToNextCandidatesPage(page, pageNumber);
      if (!hasNext) {
        console.log(`[page ${pageNumber}] could not reach next page — stopping`);
        logger.info('No next page — stopping', { totalResumesDownloaded, pageNumber });
        break;
      }

      pageNumber++;
      await delay(1000);
    }
  } finally {
    await launched.close();
  }

  if (isDriveUploadEnabled(config) && batches.some((batch) => batch.status === 'downloaded')) {
    console.log('\nAll pages downloaded. Starting Drive upload...');
    try {
      const uploadResult = await unzipAndUploadAllBatches(config, batches);
      if (uploadResult) {
        totalUploadedToDrive = uploadResult.totalUploadedToDrive;
        driveUploadFailed = uploadResult.driveUploadFailed;
        console.log(
          `\nDrive upload complete | uploaded=${totalUploadedToDrive} failed=${driveUploadFailed}`,
        );
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : String(uploadError);
      logger.error('Batch unzip/upload failed', { error: message });
      console.log(`\nDrive upload failed | ${message}`);
    }
  }

  return {
    batches,
    totalResumesDownloaded,
    totalUploadedToDrive,
    driveUploadFailed,
    downloadLimit: config.downloadLimit,
    resultsTotal,
  };
}
