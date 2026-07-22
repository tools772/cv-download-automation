#!/usr/bin/env node
/**
 * Build recruiter zip into ./recruiter/
 *
 *   npm run package:recruiter -- --portal-env ../ats-perfect-ventures/.env.local
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const recruiterDir = path.join(root, "recruiter");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "release",
  "recruiter",
  "dist",
  "sessions",
  "logs",
]);

const SKIP_FILES = new Set([".env.local", ".env", ".DS_Store"]);

const RECRUITER_GUIDES = [
  "QUICK-START.md",
  "MAC-SETUP.md",
  "WINDOWS-SETUP.md",
];

function parseArgs(argv) {
  const out = { portalEnv: null, email: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--portal-env" && argv[i + 1]) {
      out.portalEnv = path.resolve(argv[++i]);
    } else if (argv[i] === "--email" && argv[i + 1]) {
      out.email = argv[++i].trim().toLowerCase();
    }
  }
  return out;
}

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const base = path.basename(src);
    if (SKIP_DIRS.has(base)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  if (SKIP_FILES.has(path.basename(src))) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function loadPortalSupabase(portalEnvPath) {
  if (!portalEnvPath || !fs.existsSync(portalEnvPath)) {
    return { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };
  }
  const vars = parseEnvFile(fs.readFileSync(portalEnvPath, "utf8"));
  return {
    SUPABASE_URL: vars.VITE_SUPABASE_URL || vars.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: vars.VITE_SUPABASE_ANON_KEY || vars.SUPABASE_ANON_KEY || "",
  };
}

function writeTeamDefaults(stagingDir, supabase, email) {
  const configDir = path.join(stagingDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  const emailLine = email || "__YOUR_PORTAL_EMAIL_HERE__";
  fs.writeFileSync(
    path.join(configDir, "team.defaults.env"),
    [
      "# Pre-configured for Perfect Ventures — edit email only if needed",
      "",
      `SUPABASE_URL=${supabase.SUPABASE_URL}`,
      `SUPABASE_ANON_KEY=${supabase.SUPABASE_ANON_KEY}`,
      `COMPANION_PORTAL_USER_EMAIL=${emailLine}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function copyRecruiterGuidesIntoZip(stagingDir) {
  for (const name of RECRUITER_GUIDES) {
    const src = path.join(recruiterDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(stagingDir, name));
    }
  }
}

function makeZip(stagingDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  for (const old of fs.readdirSync(recruiterDir).filter((n) => n.endsWith(".zip"))) {
    fs.unlinkSync(path.join(recruiterDir, old));
  }
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const dirName = path.basename(stagingDir);
  const parent = path.dirname(stagingDir);
  const r = spawnSync("zip", ["-r", zipPath, dirName], { cwd: parent, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error("zip failed — distribute the unstaged folder from recruiter/ instead.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = loadPortalSupabase(args.portalEnv);

  if (!supabase.SUPABASE_URL || !supabase.SUPABASE_ANON_KEY) {
    console.warn("Warning: missing Supabase in --portal-env; recruiters will need manual setup.");
  }

  fs.mkdirSync(recruiterDir, { recursive: true });

  const folderName = `perfect-ventures-fetch-agent-v${pkg.version}`;
  const stagingDir = path.join(recruiterDir, folderName);

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  console.log(`Staging ${stagingDir}…`);
  for (const name of fs.readdirSync(root)) {
    if (SKIP_DIRS.has(name)) continue;
    copyRecursive(path.join(root, name), path.join(stagingDir, name));
  }

  writeTeamDefaults(stagingDir, supabase, args.email);
  copyRecruiterGuidesIntoZip(stagingDir);

  for (const name of ["Install Fetch Agent.command", "Start Fetch Agent.command"]) {
    const launcher = path.join(stagingDir, name);
    if (fs.existsSync(launcher)) fs.chmodSync(launcher, 0o755);
  }

  const zipPath = path.join(recruiterDir, `${folderName}.zip`);
  console.log(`Creating ${zipPath}…`);
  makeZip(stagingDir, zipPath);

  fs.rmSync(stagingDir, { recursive: true, force: true });

  console.log("\nRecruiter package ready:");
  console.log(`  ${zipPath}`);
  console.log(`  Guides: recruiter/MAC-SETUP.md  recruiter/WINDOWS-SETUP.md`);
  console.log("\nUpload the .zip and share recruiter/QUICK-START.md if helpful.\n");
}

main();
