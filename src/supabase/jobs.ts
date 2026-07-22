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
  error_message: string | null;
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

export async function claimNextQueuedJob(agentId: string): Promise<FetchJobRow | null> {
  const supabase = getSupabase();

  let query = supabase
    .from("fetch_jobs")
    .select("*")
    .eq("runner", "companion")
    .eq("status", "Queued")
    .order("started_at", { ascending: true })
    .limit(1);

  if (portalUserEmail) {
    query = query.eq("portal_user_email", portalUserEmail);
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
    .eq("status", "Queued")
    .select("*")
    .maybeSingle();

  if (claimError) throw new Error(`Claim job failed: ${claimError.message}`);
  return (claimed as FetchJobRow) ?? null;
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

export async function updateJob(jobId: string, updates: Partial<FetchJobRow>): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("fetch_jobs").update(updates).eq("id", jobId);
  if (error) throw new Error(`Update job ${jobId} failed: ${error.message}`);
}

export async function markJobFailed(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, {
    status: "Failed",
    error_message: message,
    completed_at: new Date().toISOString(),
    action_requested: null,
  });
}

export async function markJobNeedsLogin(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, {
    status: "Needs Login",
    error_message: message,
    action_requested: null,
  });
}

export async function markJobDownloadComplete(
  jobId: string,
  downloaded: number,
  uploaded: number,
): Promise<void> {
  await updateJob(jobId, {
    status: "Creating candidates",
    downloaded_count: downloaded,
    uploaded_count: uploaded,
    error_message: null,
    action_requested: null,
  });
}

export async function clearReconnectRequest(jobId: string): Promise<void> {
  await updateJob(jobId, { action_requested: null });
}
