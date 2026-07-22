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
  hasNaukriSession,
} from "../storage/session.js";
import { runNpmScript, parseDownloadCounts, mapErrorToJobStatus } from "./spawn.js";
import { updateJob, markJobFailed, markJobNeedsLogin, markJobDownloadComplete } from "../supabase/jobs.js";

function jobDriveError(job: FetchJobRow): string | null {
  if (!job.drive_folder_id?.trim()) return "Missing drive_folder_id on fetch job";
  if (!job.drive_access_token?.trim()) return "Missing drive_access_token on fetch job";
  return null;
}

function buildInstahyreEnv(job: FetchJobRow): Record<string, string> {
  return {
    GOOGLE_DRIVE_ACCESS_TOKEN: job.drive_access_token!.trim(),
    INSTAHYRE_CANDIDATES_URL: job.source_url,
    DOWNLOAD_LIMIT: String(job.requested_count ?? 30),
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
    DOWNLOAD_LIMIT: String(job.requested_count ?? 30),
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

  if (!(await hasInstahyreSession())) {
    await markJobNeedsLogin(job.id, "No Instahyre session. Run: npm run login-instahyre");
    return;
  }

  await updateJob(job.id, { status: "Opening Instahyre", error_message: null });
  await updateJob(job.id, { status: "Downloading resumes" });

  const { code, stdout, stderr } = await runNpmScript(
    instahyreBulkDir,
    "download",
    buildInstahyreEnv(job),
  );
  const output = stdout + stderr;

  if (code !== 0) {
    const msg = output.trim() || `Instahyre download exited with code ${code}`;
    if (mapErrorToJobStatus(msg) === "needs_login") {
      await markJobNeedsLogin(job.id, msg);
    } else {
      await markJobFailed(job.id, msg);
    }
    return;
  }

  await updateJob(job.id, { status: "Uploading" });
  const { downloaded, uploaded } = parseDownloadCounts(output);
  const limit = job.requested_count ?? 30;
  await markJobDownloadComplete(
    job.id,
    downloaded || limit,
    uploaded || downloaded || limit,
  );
}

export async function processNaukriJob(job: FetchJobRow): Promise<void> {
  const driveErr = jobDriveError(job);
  if (driveErr) {
    await markJobFailed(job.id, driveErr);
    return;
  }

  if (!(await hasNaukriSession())) {
    await markJobNeedsLogin(
      job.id,
      "No Naukri session. Run: npm run login-naukri (sign in manually in Chrome)",
    );
    return;
  }

  await updateJob(job.id, { status: "Opening source", error_message: null });
  await updateJob(job.id, { status: "Downloading resumes" });

  const { code, stdout, stderr } = await runNpmScript(
    naukriBulkDir,
    "download-resdex",
    buildNaukriEnv(job),
  );
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

  await updateJob(job.id, { status: "Uploading to Drive" });
  const { downloaded, uploaded } = parseDownloadCounts(output);
  const limit = job.requested_count ?? 30;
  await markJobDownloadComplete(
    job.id,
    downloaded || limit,
    uploaded || downloaded || limit,
  );
}

export async function processFetchJob(job: FetchJobRow): Promise<void> {
  console.log(`[agent] ${job.provider} job ${job.id} (${job.requested_count ?? "?"} CVs)`);

  if (job.provider === "instahyre") {
    await processInstahyreJob(job);
    return;
  }
  if (job.provider === "naukri") {
    await processNaukriJob(job);
    return;
  }

  await markJobFailed(job.id, `Unsupported provider: ${job.provider}`);
}
