import { assertConfig, portalUserEmail, perfectVenturesHome } from "./config.js";
import { registerAgent } from "./supabase/agents.js";
import { startPoller, stopPoller } from "./poller.js";
import { ensurePerfectVenturesDir } from "./storage/session.js";

async function main(): Promise<void> {
  assertConfig();
  await ensurePerfectVenturesDir();

  console.log("Perfect Ventures Fetch Agent");
  console.log(`Version 0.1.0 | Providers: Instahyre, Naukri`);
  console.log(`Session dir: ${perfectVenturesHome}`);
  if (portalUserEmail) {
    console.log(`Portal user: ${portalUserEmail}`);
  } else {
    console.log("No COMPANION_PORTAL_USER_EMAIL — will claim any companion Queued job");
  }

  const agentId = await registerAgent();

  const shutdown = () => {
    console.log("\n[agent] Shutting down...");
    stopPoller();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await startPoller(agentId);
}

main().catch((err) => {
  console.error("[agent] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
