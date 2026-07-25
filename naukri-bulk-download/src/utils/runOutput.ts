import type { ResdexResumeDownloadResult } from '../resdex/downloadTopResumes.js';

export function printProfileStatus(result: ResdexResumeDownloadResult): void {
  const name = result.candidateName ? ` ${result.candidateName}` : '';
  const detail =
    result.error ??
    result.skipReason ??
    result.driveUploadError ??
    result.localPath ??
    result.status;
  console.log(`[rank ${result.rank}]${name} status=${result.status} | ${detail}`);
}

export function printRunSummary(
  results: ResdexResumeDownloadResult[],
  opts: { localSaveDir?: string; driveFolderId?: string } = {},
): void {
  const uploaded = results.filter((r) => r.status === 'uploaded').length;
  const clicked = results.filter((r) => r.status === 'clicked').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const downloaded = uploaded + clicked;

  console.log('\n--- Resdex summary ---');
  console.log(`totalResumesDownloaded=${downloaded}`);
  console.log(`totalUploadedToDrive=${uploaded}`);
  console.log(`clicked=${clicked} skipped=${skipped} failed=${failed}`);
  if (opts.localSaveDir) console.log(`Local folder: ${opts.localSaveDir}`);
  if (opts.driveFolderId) {
    console.log(`Drive folder: https://drive.google.com/drive/folders/${opts.driveFolderId}`);
  }
  console.log(`totalResumesDownloaded=${downloaded}`);
  console.log(`totalSuccess=${uploaded + clicked}`);
  console.log(`totalSkipped=${skipped}`);
  console.log(`totalFailed=${failed}`);
}
