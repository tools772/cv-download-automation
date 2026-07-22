#!/usr/bin/env node
/**
 * Full first-run: setup .env.local + npm install + subproject installs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function nodeVersionOk() {
  const major = Number.parseInt(process.version.slice(1).split(".")[0], 10);
  return major >= 18;
}

async function main() {
  console.log("\n=== Fetch Agent — First-time install ===\n");

  run("node", ["scripts/fix-mac-launchers.mjs"]);

  if (!nodeVersionOk()) {
    console.error("Node.js 18+ required. Install from https://nodejs.org");
    process.exit(1);
  }

  const envLocal = path.join(root, ".env.local");
  if (!fs.existsSync(envLocal)) {
    console.log("Running setup…\n");
    run("node", ["scripts/setup.mjs"]);
  } else {
    console.log(".env.local already exists — skipping setup.\n");
  }

  console.log("Installing dependencies (may take a few minutes)…\n");
  run("npm", ["install"]);

  console.log("\n=== Install complete ===\n");
  console.log("One-time login to job boards:");
  console.log("  npm run login-instahyre");
  console.log("  npm run login-naukri");
  console.log("\nThen start the agent:");
  console.log("  npm start");
  console.log("  (or double-click Start Fetch Agent.command on Mac)\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
