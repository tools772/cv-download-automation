import type { BrowserContext, Download, Page } from 'playwright';
import { RESUME_DOWNLOAD_TIMEOUT_MS } from '../resdex/constants.js';

export interface ManualDownloadClickResult {
  kind: 'saved-to-folder' | 'pdf-tab' | 'needs-user-action';
  savedPath?: string;
  pdfPage?: Page;
}

/** Call before clicking Download CV. */
export function watchAfterDownloadClick(
  context: BrowserContext,
  _mainPage: Page,
): { download: Promise<Download | null>; newPage: Promise<Page | null> } {
  const download = context
    .waitForEvent('download', { timeout: RESUME_DOWNLOAD_TIMEOUT_MS })
    .catch(() => null);
  const newPage = context
    .waitForEvent('page', { timeout: 12_000 })
    .catch(() => null);

  return { download, newPage };
}

/** Verbose manual-save hints — use printProfileStatus in the download script instead. */
export function logManualSaveResult(
  _result: ManualDownloadClickResult,
  _rank: number,
): void {
  // intentionally quiet
}

/** Startup banner — details go to logs only. */
export function getManualModeStartupMessage(_config: unknown): string {
  return '';
}
