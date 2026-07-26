import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root in dev; `resources/agent` when running inside the desktop installer. */
export const agentRoot = process.env.FETCH_AGENT_ROOT?.trim()
  ? path.resolve(process.env.FETCH_AGENT_ROOT.trim())
  : path.resolve(__dirname, "..");

const userDataDir = process.env.FETCH_AGENT_USER_DATA?.trim();

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

dotenv.config({ path: path.join(agentRoot, ".env") });
dotenv.config({ path: path.join(agentRoot, ".env.local") });
if (userDataDir) {
  // AppData prefs (email, etc). May also contain stale SUPABASE_* from an older install.
  dotenv.config({ path: path.join(userDataDir, ".env.local"), override: true });
}

const teamDefaultsPath = path.join(agentRoot, "config", "team.defaults.env");
if (fs.existsSync(teamDefaultsPath)) {
  if (userDataDir) {
    // Packaged Electron app: installer-bundled Supabase must win over AppData.
    // Otherwise a previous prod install keeps pointing at the wrong project forever.
    const bundled = parseEnvFile(teamDefaultsPath);
    if (bundled.SUPABASE_URL) process.env.SUPABASE_URL = bundled.SUPABASE_URL;
    if (bundled.SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = bundled.SUPABASE_ANON_KEY;
  } else {
    dotenv.config({ path: teamDefaultsPath, override: false });
  }
}

export const AGENT_VERSION = "0.1.0";
export const POLL_INTERVAL_MS = Number(process.env.COMPANION_POLL_INTERVAL_MS) || 5000;
export const HEARTBEAT_INTERVAL_MS = Number(process.env.COMPANION_HEARTBEAT_INTERVAL_MS) || 30_000;

export const perfectVenturesHome = path.join(os.homedir(), "PerfectVentures");

export const instahyreSessionPath = path.join(perfectVenturesHome, "storageState.json");
export const naukriSessionPath = path.join(perfectVenturesHome, "naukri-storage-state.json");
export const naukriChromeProfileDir = path.join(perfectVenturesHome, "naukri-chrome-profile");
export const localDownloadsDir = path.join(perfectVenturesHome, "downloads");

export const naukriBulkDir = path.join(agentRoot, "naukri-bulk-download");
export const instahyreBulkDir = path.join(agentRoot, "instahyre-bulk-download");

export const supabaseUrl =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || "";
export const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  "";

export const portalUserEmail = process.env.COMPANION_PORTAL_USER_EMAIL?.trim().toLowerCase() || "";

export function assertConfig(): void {
  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL in .env or .env.local");
  }
  if (!supabaseServiceKey) {
    throw new Error("Missing SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }
}
