import path from "node:path";
import type { FetchJobRow } from "../supabase/jobs.js";
import {
  instahyreBulkDir,
  naukriBulkDir,
  perfectVenturesHome,
  localDownloadsDir,
} from "../config.js";
import {
  getInstahyreSessionPath,
  getNaukriSessionPath,
  hasInstahyreSession,
} from "../storage/session.js";
import { runNpmScript, parseFetchRunStats, mapErrorToJobStatus } from "./spawn.js";
import { extractInstahyreFailureSummary } from "./instahyreErrors.js";
import { createProgressReporter } from "./progressFromLogs.js";
import { clampDownloadLimit } from "../limits.js";
import {
  updateJob,
  markJobFailed,
  markJobNeedsLogin,
  markJobDownloadComplete,
  getJob,
} from "../supabase/jobs.js";

async function isJobCancelled(jobId: string): Promise<boolean> {
  const latest = await getJob(jobId);
  return latest?.status === "Cancelled";
}

async function finishIfCancelled(jobId: string): Promise<boolean> {
  if (!(await isJobCancelled(jobId))) return false;
  console.log(`[agent] Job ${jobId} cancelled — leaving status as Cancelled`);
  await updateJob(jobId, {
    progress_message: "Cancelled — automation stopped.",
  }).catch(() => undefined);
  return true;
}

function jobDriveError(job: FetchJobRow): string | null {
  if (!job.drive_folder_id?.trim()) return "Missing drive_folder_id on fetch job";
  if (!job.drive_access_token?.trim()) return "Missing drive_access_token on fetch job";
  return null;
}

function buildInstahyreEnv(job: FetchJobRow): Record<string, string> {
  const sourceUrl = job.source_url?.trim();
  if (!sourceUrl) {
    throw new Error("Missing source_url on Instahyre fetch job");
  }
  return {
    GOOGLE_DRIVE_ACCESS_TOKEN: job.drive_access_token!.trim(),
    INSTAHYRE_CANDIDATES_URL: sourceUrl,
    DOWNLOAD_LIMIT: String(clampDownloadLimit(job.requested_count, 30)),
    GOOGLE_DRIVE_FOLDER_ID: job.drive_folder_id!.trim(),
    UPLOAD_TO_DRIVE_AFTER_DOWNLOAD: "true",
    HEADLESS: "false",
    INSTAHYRE_MANUAL_LOGIN: "false",
    INSTAHYRE_SESSION_DIR: perfectVenturesHome,
    STORAGE_STATE_FILE: path.basename(getInstahyreSessionPath()),
    INSTAHYRE_LOCAL_SAVE_DIR: localDownloadsDir,
  };
}

function buildNaukriEnv(job: FetchJobRow): Record<string, string> {
  return {
    GOOGLE_DRIVE_ACCESS_TOKEN: job.drive_access_token!.trim(),
    RESDEX_SAVED_SEARCH_URL: job.source_url,
    DOWNLOAD_LIMIT: String(clampDownloadLimit(job.requested_count, 30)),
    DOWNLOAD_START_RANK: "1",
    GOOGLE_DRIVE_FOLDER_ID: job.drive_folder_id!.trim(),
    UPLOAD_TO_DRIVE_AFTER_DOWNLOAD: "true",
    MANUAL_RESDEX_LOGIN: "true",
    MANUAL_DOWNLOAD_SAVE: "false",
    HEADLESS: "false",
    SESSION_DIR: perfectVenturesHome,
    NAUKRI_SESSION_DIR: perfectVenturesHome,
    STORAGE_STATE_FILE: path.basename(getNaukriSessionPath()),
    NAUKRI_STORAGE_STATE_FILE: path.basename(getNaukriSessionPath()),
    LOCAL_SAVE_DIR: localDownloadsDir,
  };
}

export async function processInstahyreJob(job: FetchJobRow): Promise<void> {
  const driveErr = jobDriveError(job);
  if (driveErr) {
    await markJobFailed(job.id, driveErr);
    return;
  }

  const sourceUrl = job.source_url?.trim();
  if (!sourceUrl || !/^https?:\/\/(www\.)?instahyre\.com\/employer\/candidates\/\d+\/\d+/i.test(sourceUrl)) {
    await markJobFailed(
      job.id,
      `Invalid Instahyre source URL on fetch job: ${sourceUrl || "(empty)"}. Paste the candidates URL from Upload Resumes.`,
    );
    return;
  }

  console.log(`[agent] Instahyre fetch job ${job.id} → ${sourceUrl}`);

  if (!(await hasInstahyreSession())) {
    console.log(`[agent] Needs Login — no Instahyre session for job ${job.id}`);
    await markJobNeedsLogin(
      job.id,
      "No Instahyre session. In the Fetch Agent app, click Login Instahyre, sign in in Chrome, then retry.",
    );
    return;
  }

  await updateJob(job.id, { status: "Opening Instahyre", error_message: null, progress_message: "Opening Instahyre…" });
  await updateJob(job.id, {
    status: "Downloading resumes",
    progress_message: "Starting Instahyre download…",
  });

  const reportProgress = createProgressReporter(job.id);
  const { code, stdout, stderr, cancelled } = await runNpmScript(
    instahyreBulkDir,
    "download",
    buildInstahyreEnv(job),
    (line) => reportProgress(line),
    { shouldCancel: () => isJobCancelled(job.id) },
  );
  if (cancelled || (await finishIfCancelled(job.id))) {
    return;
  }
  const output = stdout + stderr;

  if (code !== 0) {
    const raw = output.trim() || `Instahyre download exited with code ${code}`;
    const msg = extractInstahyreFailureSummary(output) || raw.slice(0, 500);
    console.error(`[agent] Instahyre job failed: ${msg}`);
    if (mapErrorToJobStatus(raw) === "needs_login") {
      await markJobNeedsLogin(job.id, msg);
    } else {
      await markJobFailed(job.id, msg);
    }
    return;
  }

  const stats = parseFetchRunStats(output);
  const attempted = stats.success + stats.skipped + stats.failed;
  if (stats.success === 0 && stats.downloaded === 0) {
    const msg =
      extractInstahyreFailureSummary(output) ||
      "Instahyre finished without downloading any CVs. Leave the browser open and confirm the candidates URL is correct.";
    await markJobFailed(job.id, msg);
    return;
  }

  await updateJob(job.id, { status: "Uploading", progress_message: "Finishing Drive upload…" });
  const limit = clampDownloadLimit(job.requested_count, 30);
  await markJobDownloadComplete(job.id, {
    discovered: stats.discovered || attempted || limit,
    downloaded: stats.downloaded || stats.success || 0,
    uploaded: stats.uploaded || stats.success || stats.downloaded || 0,
    skipped: stats.skipped,
    failed: stats.failed,
  });
  console.log(
    `[agent] Download complete — job ${job.id} ready for ranking ` +
      `(uploaded=${stats.uploaded || stats.success || stats.downloaded || 0})`,
  );
}

export async function processNaukriJob(job: FetchJobRow): Promise<void> {
  const driveErr = jobDriveError(job);
  if (driveErr) {
    await markJobFailed(job.id, driveErr);
    return;
  }

  await updateJob(job.id, {
    status: "Opening source",
    error_message: null,
    progress_message: "Opening Naukri Resdex…",
  });
  await updateJob(job.id, {
    status: "Downloading resumes",
    progress_message: "Starting Naukri download…",
  });

  const reportProgress = createProgressReporter(job.id);
  const { code, stdout, stderr, cancelled } = await runNpmScript(
    naukriBulkDir,
    "download-resdex",
    buildNaukriEnv(job),
    (line) => reportProgress(line),
    { shouldCancel: () => isJobCancelled(job.id) },
  );
  if (cancelled || (await finishIfCancelled(job.id))) {
    return;
  }
  const output = stdout + stderr;

  if (code !== 0) {
    const msg = output.trim() || `Naukri download exited with code ${code}`;
    if (mapErrorToJobStatus(msg) === "needs_login") {
      await markJobNeedsLogin(job.id, msg);
    } else {
      await markJobFailed(job.id, msg);
    }
    return;
  }

  await updateJob(job.id, {
    status: "Uploading to Drive",
    progress_message: "Finishing Drive upload…",
  });
  const stats = parseFetchRunStats(output);
  const limit = clampDownloadLimit(job.requested_count, 30);
  const attempted = stats.success + stats.skipped + stats.failed;
  await markJobDownloadComplete(job.id, {
    discovered: stats.discovered || attempted || limit,
    downloaded: stats.downloaded || stats.success || 0,
    uploaded: stats.uploaded || stats.success || stats.downloaded || 0,
    skipped: stats.skipped,
    failed: stats.failed,
  });
  console.log(
    `[agent] Download complete — job ${job.id} ready for ranking ` +
      `(uploaded=${stats.uploaded || stats.success || stats.downloaded || 0})`,
  );
}

export async function processFetchJob(job: FetchJobRow): Promise<void> {
  const latest = await getJob(job.id);
  if (latest?.status === "Cancelled") {
    console.log(`[agent] Skipping cancelled job ${job.id}`);
    return;
  }

  const activeJob = latest ?? job;

  console.log(`[agent] ${activeJob.provider} job ${activeJob.id} (${activeJob.requested_count ?? "?"} CVs)`);
  if (activeJob.provider === "instahyre") {
    console.log(`[agent] Job source_url: ${activeJob.source_url}`);
  }
  if (activeJob.provider === "naukri") {
    console.log(`[agent] Job source_url: ${activeJob.source_url}`);
  }

  if (activeJob.provider === "instahyre") {
    await processInstahyreJob(activeJob);
    return;
  }
  if (activeJob.provider === "naukri") {
    await processNaukriJob(activeJob);
    return;
  }

  await markJobFailed(activeJob.id, `Unsupported provider: ${activeJob.provider}`);
}
