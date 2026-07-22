#!/usr/bin/env node
/**
 * First-run setup: create .env.local (merge team defaults + portal email).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envLocalPath = path.join(root, ".env.local");
const teamDefaultsPath = path.join(root, "config", "team.defaults.env");

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(vars) {
  const lines = [
    "# Fetch Agent — local config (do not commit)",
    "",
    `SUPABASE_URL=${vars.SUPABASE_URL || ""}`,
    `SUPABASE_ANON_KEY=${vars.SUPABASE_ANON_KEY || ""}`,
    "",
    "# Same email you use to log into the Caliber portal",
    `COMPANION_PORTAL_USER_EMAIL=${vars.COMPANION_PORTAL_USER_EMAIL || ""}`,
    "",
    "COMPANION_POLL_INTERVAL_MS=5000",
    "COMPANION_HEARTBEAT_INTERVAL_MS=30000",
    "",
  ];
  return lines.join("\n");
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadTeamDefaults() {
  if (!fs.existsSync(teamDefaultsPath)) return {};
  return parseEnvFile(fs.readFileSync(teamDefaultsPath, "utf8"));
}

function loadExistingEnvLocal() {
  if (!fs.existsSync(envLocalPath)) return {};
  return parseEnvFile(fs.readFileSync(envLocalPath, "utf8"));
}

function mapPortalEnv(vars) {
  return {
    SUPABASE_URL: vars.SUPABASE_URL || vars.VITE_SUPABASE_URL || "",
    SUPABASE_ANON_KEY: vars.SUPABASE_ANON_KEY || vars.VITE_SUPABASE_ANON_KEY || "",
    COMPANION_PORTAL_USER_EMAIL: vars.COMPANION_PORTAL_USER_EMAIL || "",
  };
}

async function main() {
  console.log("\n=== Perfect Ventures Fetch Agent — Setup ===\n");

  const team = loadTeamDefaults();
  const existing = loadExistingEnvLocal();
  let vars = { ...mapPortalEnv(team), ...existing };

  if (!vars.SUPABASE_URL || !vars.SUPABASE_ANON_KEY) {
    console.log("Supabase URL/key not found in config/team.defaults.env");
    if (!vars.SUPABASE_URL) {
      vars.SUPABASE_URL = await ask("SUPABASE_URL: ");
    }
    if (!vars.SUPABASE_ANON_KEY) {
      vars.SUPABASE_ANON_KEY = await ask("SUPABASE_ANON_KEY: ");
    }
  } else {
    console.log(`Supabase: ${vars.SUPABASE_URL}`);
  }

  let email = vars.COMPANION_PORTAL_USER_EMAIL?.replace(/^__YOUR_.*_HERE__$/i, "") || "";
  if (!email || email.includes("YOUR_")) {
    email = await ask("Your Caliber portal email: ");
  }
  vars.COMPANION_PORTAL_USER_EMAIL = email.toLowerCase();

  fs.writeFileSync(envLocalPath, serializeEnv(vars), "utf8");
  console.log(`\nWrote ${envLocalPath}`);
  console.log("\nNext steps:");
  console.log("  npm install");
  console.log("  npm run login-instahyre");
  console.log("  npm run login-naukri");
  console.log("  npm start\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
