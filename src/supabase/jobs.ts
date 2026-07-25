import { getSupabase } from "./client.js";
import { portalUserEmail } from "../config.js";

export interface FetchJobRow {
  id: string;
  jd_id: string;
  source_url: string;
  provider: string;
  status: string;
  downloaded_count: number;
  uploaded_count: number;
  ranked_count: number;
  discovered_count: number;
  skipped_count: number;
  failed_count: number;
  error_message: string | null;
  progress_message: string | null;
  started_at: string;
  completed_at: string | null;
  requested_count: number | null;
  drive_folder_id: string | null;
  portal_user_email: string | null;
  assigned_agent_id: string | null;
  runner: string;
  drive_access_token: string | null;
  action_requested: string | null;
  claimed_at: string | null;
}

async function tryClaimJob(
  agentId: string,
  status: string,
  opts?: { requireDriveFields?: boolean },
): Promise<FetchJobRow | null> {
  const supabase = getSupabase();

  let query = supabase
    .from("fetch_jobs")
    .select("*")
    .eq("runner", "companion")
    .eq("status", status)
    .order("started_at", { ascending: true })
    .limit(1);

  if (portalUserEmail) {
    query = query.eq("portal_user_email", portalUserEmail);
  }
  if (opts?.requireDriveFields) {
    query = query.not("drive_folder_id", "is", null).not("drive_access_token", "is", null);
  }

  const { data: candidates, error } = await query;
  if (error) throw new Error(`Poll fetch_jobs failed: ${error.message}`);
  if (!candidates?.length) return null;

  const job = candidates[0] as FetchJobRow;
  const now = new Date().toISOString();

  const { data: claimed, error: claimError } = await supabase
    .from("fetch_jobs")
    .update({
      status: "Starting",
      assigned_agent_id: agentId,
      claimed_at: now,
      action_requested: null,
      error_message: null,
    })
    .eq("id", job.id)
    .eq("status", status)
    .select("*")
    .maybeSingle();

  if (claimError) throw new Error(`Claim job failed: ${claimError.message}`);
  return (claimed as FetchJobRow) ?? null;
}

export async function claimNextQueuedJob(agentId: string): Promise<FetchJobRow | null> {
  const queued = await tryClaimJob(agentId, "Queued");
  if (queued) return queued;

  // Portal may leave companion jobs on Validating URL when Drive fields are already set.
  return tryClaimJob(agentId, "Validating URL", { requireDriveFields: true });
}

export async function findReconnectJobs(): Promise<FetchJobRow[]> {
  const supabase = getSupabase();

  let query = supabase
    .from("fetch_jobs")
    .select("*")
    .eq("action_requested", "reconnect_instahyre")
    .in("status", ["Needs Login", "Queued"]);

  if (portalUserEmail) {
    query = query.eq("portal_user_email", portalUserEmail);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Find reconnect jobs failed: ${error.message}`);
  return (data as FetchJobRow[]) ?? [];
}

export async function getJob(jobId: string): Promise<FetchJobRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("fetch_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Get job ${jobId} failed: ${error.message}`);
  return (data as FetchJobRow) ?? null;
}

export async function markJobCancelled(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, {
    status: "Cancelled",
    error_message: message,
    progress_message: null,
    completed_at: new Date().toISOString(),
    action_requested: null,
  });
}

export async function updateJob(jobId: string, updates: Partial<FetchJobRow>): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("fetch_jobs").update(updates).eq("id", jobId);
  if (error) {
    const missingProgress = /progress_message|schema cache/i.test(error.message);
    if (missingProgress && "progress_message" in updates) {
      const { progress_message: _drop, ...rest } = updates;
      if (Object.keys(rest).length === 0) return;
      const retry = await supabase.from("fetch_jobs").update(rest).eq("id", jobId);
      if (retry.error) throw new Error(`Update job ${jobId} failed: ${retry.error.message}`);
      return;
    }
    throw new Error(`Update job ${jobId} failed: ${error.message}`);
  }
}

/** Best-effort progress update — ignores missing progress_message / count columns. */
export async function setJobProgress(
  jobId: string,
  message: string,
  counts?: Partial<{
    discovered: number;
    downloaded: number;
    uploaded: number;
    skipped: number;
    failed: number;
  }>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    progress_message: message.slice(0, 500),
  };
  if (counts?.discovered != null) payload.discovered_count = counts.discovered;
  if (counts?.downloaded != null) payload.downloaded_count = counts.downloaded;
  if (counts?.uploaded != null) payload.uploaded_count = counts.uploaded;
  if (counts?.skipped != null) payload.skipped_count = counts.skipped;
  if (counts?.failed != null) payload.failed_count = counts.failed;

  try {
    await updateJob(jobId, payload as Partial<FetchJobRow>);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (/progress_message|discovered_count|skipped_count|failed_count|schema cache/i.test(messageText)) {
      const fallback: Record<string, unknown> = {};
      if (counts?.downloaded != null) fallback.downloaded_count = counts.downloaded;
      if (counts?.uploaded != null) fallback.uploaded_count = counts.uploaded;
      if (Object.keys(fallback).length === 0) return;
      try {
        await updateJob(jobId, fallback as Partial<FetchJobRow>);
      } catch {
        // ignore progress write failures
      }
      return;
    }
    // ignore transient progress write failures
  }
}

export async function markJobFailed(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, {
    status: "Failed",
    error_message: message,
    progress_message: null,
    completed_at: new Date().toISOString(),
    action_requested: null,
  });
}

export async function markJobNeedsLogin(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, {
    status: "Needs Login",
    error_message: message,
    progress_message: null,
    action_requested: null,
  });
}

export async function markJobDownloadComplete(
  jobId: string,
  stats: {
    discovered: number;
    downloaded: number;
    uploaded: number;
    skipped: number;
    failed: number;
  },
): Promise<void> {
  const payload = {
    status: "Creating candidates" as const,
    discovered_count: stats.discovered,
    downloaded_count: stats.downloaded,
    uploaded_count: stats.uploaded,
    skipped_count: stats.skipped,
    failed_count: stats.failed,
    error_message: null,
    progress_message: `Download complete — ${stats.uploaded || stats.downloaded} CV(s) ready for ranking`,
    action_requested: null,
  };

  try {
    await updateJob(jobId, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingCountColumns = /discovered_count|skipped_count|failed_count|progress_message|schema cache/i.test(message);
    if (!missingCountColumns) {
      throw error;
    }

    console.warn(
      "[agent] fetch_jobs missing discovered/skipped/failed/progress columns — saving downloaded/uploaded only. " +
        "Apply migration 20260724153000_fetch_job_progress_and_counts.sql on Supabase.",
    );
    await updateJob(jobId, {
      status: "Creating candidates",
      downloaded_count: stats.downloaded,
      uploaded_count: stats.uploaded,
      error_message: null,
      action_requested: null,
    });
  }
}

export async function clearReconnectRequest(jobId: string): Promise<void> {
  await updateJob(jobId, { action_requested: null });
}
