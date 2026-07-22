#!/usr/bin/env node
/**
 * macOS: make .command files executable and strip Gatekeeper quarantine (from zip download).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launchers = ["Install Fetch Agent.command", "Start Fetch Agent.command"];

if (process.platform !== "darwin") {
  process.exit(0);
}

for (const name of launchers) {
  const filePath = path.join(root, name);
  if (!fs.existsSync(filePath)) continue;

  fs.chmodSync(filePath, 0o755);
  spawnSync("xattr", ["-d", "com.apple.quarantine", filePath], { stdio: "ignore" });
  console.log(`Fixed: ${name}`);
}
