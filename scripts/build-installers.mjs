#!/usr/bin/env node
/**
 * Build .dmg (mac) and/or .exe (windows) installers into recruiter/installers/
 *
 *   npm run build:installers -- --portal-env ../ats-perfect-ventures/.env.local
 *   npm run build:installers -- --portal-env ../ats-perfect-ventures/.env.local --mac
 *   npm run build:installers -- --portal-env ../ats-perfect-ventures/.env.local --win
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { portalEnv: null, mac: false, win: false, all: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--portal-env" && argv[i + 1]) out.portalEnv = path.resolve(argv[++i]);
    else if (argv[i] === "--mac") {
      out.mac = true;
      out.all = false;
    } else if (argv[i] === "--win") {
      out.win = true;
      out.all = false;
    }
  }
  if (out.all) {
    out.mac = process.platform === "darwin";
    out.win = process.platform === "win32";
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const prepArgs = ["scripts/prepare-agent-bundle.mjs"];
  if (args.portalEnv) prepArgs.push("--portal-env", args.portalEnv);

  console.log("\n=== Prepare agent bundle ===\n");
  run("node", prepArgs);

  const ebArgs = ["electron-builder", "--publish", "never"];
  if (args.mac) ebArgs.push("--mac", "dmg");
  if (args.win) ebArgs.push("--win", "nsis");

  if (!args.mac && !args.win) {
    console.error("\nNothing to build for this platform. Use --mac and/or --win.");
    console.error("  macOS .dmg  → build on a Mac:   npm run build:installers -- --mac");
    console.error("  Windows .exe → build on Windows: npm run build:installers -- --win\n");
    process.exit(1);
  }

  console.log("\n=== electron-builder ===\n");
  run("npx", ebArgs);

  console.log("\nInstallers output: recruiter/installers/\n");
}

main();
