import { POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS } from "./config.js";
import { registerAgent, sendHeartbeat, setAgentStatus } from "./supabase/agents.js";
import {
  claimNextQueuedJob,
  findReconnectJobs,
  clearReconnectRequest,
} from "./supabase/jobs.js";
import { processFetchJob } from "./providers/processJob.js";
import { connectInstahyre } from "./providers/instahyreLogin.js";

let processing = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export async function startPoller(agentId: string): Promise<void> {
  console.log(`[agent] Polling every ${POLL_INTERVAL_MS / 1000}s for queued jobs...`);

  heartbeatTimer = setInterval(() => {
    void sendHeartbeat(agentId);
  }, HEARTBEAT_INTERVAL_MS);

  for (;;) {
    try {
      if (!processing) {
        const reconnectJobs = await findReconnectJobs();
        for (const job of reconnectJobs) {
          processing = true;
          await setAgentStatus(agentId, "login");
          console.log(`[agent] Reconnect Instahyre for job ${job.id}`);
          try {
            await connectInstahyre(job.source_url);
            await clearReconnectRequest(job.id);
          } catch (err) {
            console.error("[agent] Reconnect failed:", err instanceof Error ? err.message : err);
          } finally {
            processing = false;
            await setAgentStatus(agentId, "online");
          }
          break;
        }

        if (!processing) {
          const job = await claimNextQueuedJob(agentId);
          if (job) {
            processing = true;
            await setAgentStatus(agentId, "busy");
            try {
              await processFetchJob(job);
            } finally {
              processing = false;
              await setAgentStatus(agentId, "online");
            }
          }
        }
      }
    } catch (err) {
      console.error("[agent] Poll error:", err instanceof Error ? err.message : err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export function stopPoller(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}
