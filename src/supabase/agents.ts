import os from "node:os";
import { randomUUID } from "node:crypto";
import { getSupabase } from "./client.js";
import { AGENT_VERSION, portalUserEmail } from "../config.js";

export async function registerAgent(): Promise<string> {
  const id = randomUUID();
  const supabase = getSupabase();

  const row = {
    id,
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    version: AGENT_VERSION,
    portal_user_email: portalUserEmail || null,
    status: "online",
    last_seen: new Date().toISOString(),
  };

  const { error } = await supabase.from("companion_agents").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`Failed to register agent: ${error.message}`);

  console.log(`[agent] Registered ${id} (${row.hostname})`);
  return id;
}

export async function sendHeartbeat(agentId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("companion_agents")
    .update({
      last_seen: new Date().toISOString(),
      status: "online",
      portal_user_email: portalUserEmail || null,
    })
    .eq("id", agentId);

  if (error) console.warn("[agent] Heartbeat failed:", error.message);
}

export async function setAgentStatus(agentId: string, status: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("companion_agents")
    .update({ status, last_seen: new Date().toISOString() })
    .eq("id", agentId)
    .then(({ error }) => {
      if (error) console.warn("[agent] setAgentStatus failed:", error.message);
    });
}
