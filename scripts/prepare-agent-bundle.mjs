#!/usr/bin/env node
/**
 * Stage agent + node_modules for electron-builder extraResources.
 *
 *   node scripts/prepare-agent-bundle.mjs --portal-env ../ats-perfect-ventures/.env.local
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist", "agent-bundle");

const COPY = [
  "src",
  "naukri-bulk-download",
  "instahyre-bulk-download",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

const SKIP_DIR = new Set(["node_modules", "sessions", "logs", ".git"]);

function parseArgs(argv) {
  let portalEnv = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--portal-env" && argv[i + 1]) portalEnv = path.resolve(argv[++i]);
  }
  return { portalEnv };
}

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function loadSupabaseConfig(portalEnv) {
  const fromEnv = {
    SUPABASE_URL: (
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).trim(),
    SUPABASE_ANON_KEY: (
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ""
    ).trim(),
  };
  if (fromEnv.SUPABASE_URL && fromEnv.SUPABASE_ANON_KEY) {
    return fromEnv;
  }

  if (portalEnv && fs.existsSync(portalEnv)) {
    const vars = parseEnvFile(fs.readFileSync(portalEnv, "utf8"));
    return {
      SUPABASE_URL: vars.VITE_SUPABASE_URL || vars.SUPABASE_URL || "",
      SUPABASE_ANON_KEY: vars.VITE_SUPABASE_ANON_KEY || vars.SUPABASE_ANON_KEY || "",
    };
  }

  return { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (SKIP_DIR.has(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const { portalEnv } = parseArgs(process.argv.slice(2));

  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const name of COPY) {
    const src = path.join(root, name);
    if (fs.existsSync(src)) copyRecursive(src, path.join(outDir, name));
  }

  fs.mkdirSync(path.join(outDir, "config"), { recursive: true });
  const supabase = loadSupabaseConfig(portalEnv);

  if (!supabase.SUPABASE_URL || !supabase.SUPABASE_ANON_KEY) {
    const msg =
      "Missing Supabase config. Set SUPABASE_URL + SUPABASE_ANON_KEY (CI secrets) or pass --portal-env.";
    if (process.env.CI) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(`Warning: ${msg}`);
  }

  fs.writeFileSync(
    path.join(outDir, "config", "team.defaults.env"),
    [
      "# Bundled with desktop installer",
      `SUPABASE_URL=${supabase.SUPABASE_URL}`,
      `SUPABASE_ANON_KEY=${supabase.SUPABASE_ANON_KEY}`,
      "COMPANION_PORTAL_USER_EMAIL=__YOUR_PORTAL_EMAIL_HERE__",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log("Installing agent dependencies in bundle…");
  run("npm", ["install"], outDir, {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || "1",
  });

  console.log(`Agent bundle ready: ${outDir}`);
}

main();
