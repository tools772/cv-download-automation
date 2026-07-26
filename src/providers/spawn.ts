import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentRoot } from "../config.js";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  cancelled?: boolean;
}

export type SpawnLineHandler = (line: string, stream: "stdout" | "stderr") => void;

export class JobCancelledError extends Error {
  constructor(message = "Fetch job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try {
        child.kill();
      } catch {
        // already dead
      }
    }
    return;
  }

  try {
    // Kill the whole process group when spawned detached.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 2500).unref?.();
}

function findTsxCli(cwd: string): string {
  const candidates = [
    path.join(cwd, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(agentRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `tsx not found under ${cwd}. Reinstall the Fetch Agent (system npm is not required).`,
  );
}

/** Resolve `package.json` script → TypeScript entry (e.g. download-resdex → src/scripts/...). */
function resolveNpmScriptEntry(cwd: string, script: string): string {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing package.json in ${cwd}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const cmd = pkg.scripts?.[script];
  if (!cmd) {
    throw new Error(`Unknown script "${script}" in ${pkgPath}`);
  }
  const match = cmd.match(/\btsx(?:\s+watch)?\s+(\S+\.ts[x]?)/);
  if (!match?.[1]) {
    throw new Error(`Script "${script}" is not a tsx entrypoint: ${cmd}`);
  }
  const entry = path.resolve(cwd, match[1]);
  if (!fs.existsSync(entry)) {
    throw new Error(`Script entry missing: ${entry}`);
  }
  return entry;
}

/**
 * Run a package.json script without calling system `npm`.
 * Packaged Electron apps often have no npm on PATH → spawn npm ENOENT.
 * Uses the same Electron-as-Node + bundled tsx pattern as the desktop shell.
 */
export function runNpmScript(
  cwd: string,
  script: string,
  env: Record<string, string>,
  onLine?: SpawnLineHandler,
  options?: {
    /** Called periodically; return true to abort the child. */
    shouldCancel?: () => Promise<boolean> | boolean;
    cancelPollMs?: number;
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    // Drop stale platform URLs from the agent shell so job input always wins.
    const cleanedEnv = { ...process.env };
    for (const key of [
      "INSTAHYRE_CANDIDATES_URL",
      "INSTAHYRE_SEARCH_URL",
      "RESDEX_SAVED_SEARCH_URL",
      "DOWNLOAD_LIMIT",
      "GOOGLE_DRIVE_FOLDER_ID",
      "GOOGLE_DRIVE_ACCESS_TOKEN",
    ]) {
      if (key in env) {
        delete cleanedEnv[key];
      }
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...cleanedEnv,
      ...env,
      PLAYWRIGHT_BROWSERS_PATH: "",
    };
    if (process.versions.electron) {
      childEnv.ELECTRON_RUN_AS_NODE = "1";
    }

    let tsxCli: string;
    let entry: string;
    try {
      tsxCli = findTsxCli(cwd);
      entry = resolveNpmScriptEntry(cwd, script);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (env.INSTAHYRE_CANDIDATES_URL) {
      console.log(`[agent] Instahyre candidates URL: ${env.INSTAHYRE_CANDIDATES_URL}`);
    }
    if (env.RESDEX_SAVED_SEARCH_URL) {
      console.log(`[agent] Naukri Resdex URL: ${env.RESDEX_SAVED_SEARCH_URL}`);
    }
    console.log(`[agent] Running ${script} via tsx (no system npm)`);

    const child = spawn(process.execPath, [tsxCli, entry], {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // Process groups work on Unix; Windows cancel uses taskkill /T.
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuf = "";
    let stderrBuf = "";
    let cancelled = false;
    let settled = false;

    const emitLines = (chunk: string, stream: "stdout" | "stderr") => {
      if (!onLine) return;
      const combined = (stream === "stdout" ? stdoutBuf : stderrBuf) + chunk;
      const parts = combined.split(/\r?\n/);
      if (stream === "stdout") {
        stdoutBuf = parts.pop() ?? "";
      } else {
        stderrBuf = parts.pop() ?? "";
      }
      for (const line of parts) {
        const trimmed = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (trimmed) onLine(trimmed, stream);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
      emitLines(text, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
      emitLines(text, "stderr");
    });

    const pollMs = options?.cancelPollMs ?? 2000;
    const cancelTimer =
      options?.shouldCancel &&
      setInterval(() => {
        void (async () => {
          if (cancelled || settled) return;
          try {
            const stop = await options.shouldCancel?.();
            if (!stop) return;
            cancelled = true;
            console.log(`[agent] Cancel requested — stopping ${script}…`);
            killProcessTree(child);
          } catch {
            // ignore poll errors
          }
        })();
      }, pollMs);

    if (cancelTimer && typeof cancelTimer === "object" && "unref" in cancelTimer) {
      cancelTimer.unref();
    }

    child.on("error", (err) => {
      if (cancelTimer) clearInterval(cancelTimer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (cancelTimer) clearInterval(cancelTimer);
      if (settled) return;
      settled = true;
      if (onLine) {
        const leftoverOut = stdoutBuf.replace(/\x1b\[[0-9;]*m/g, "").trim();
        const leftoverErr = stderrBuf.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (leftoverOut) onLine(leftoverOut, "stdout");
        if (leftoverErr) onLine(leftoverErr, "stderr");
      }
      resolve({
        code: cancelled ? 130 : (code ?? 1),
        stdout,
        stderr,
        cancelled,
      });
    });
  });
}

export interface FetchRunStats {
  discovered: number;
  downloaded: number;
  uploaded: number;
  success: number;
  skipped: number;
  failed: number;
}

function parseCount(output: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1] != null) return Number(match[1]) || 0;
  }
  return 0;
}

export function parseFetchRunStats(output: string): FetchRunStats {
  const uploaded = parseCount(output, [/totalUploadedToDrive[=:\s]+(\d+)/i]);
  const downloaded = parseCount(output, [
    /totalResumesDownloaded[=:\s]+(\d+)/i,
    /Downloaded\s+(\d+)\s+CV/i,
    /Resumes downloaded:\s*(\d+)/i,
  ]);
  const discovered = parseCount(output, [/totalDiscovered[=:\s]+(\d+)/i]);
  const success = parseCount(output, [
    /totalSuccess[=:\s]+(\d+)/i,
    /totalUploadedToDrive[=:\s]+(\d+)/i,
  ]);
  const skipped = parseCount(output, [/totalSkipped[=:\s]+(\d+)/i, /\bskipped=(\d+)/i]);
  const failed = parseCount(output, [/totalFailed[=:\s]+(\d+)/i, /\bfailed=(\d+)/i]);

  const pageTotal = [...output.matchAll(/status=downloaded\s*\|\s*count=(\d+)/gi)].reduce(
    (sum, m) => sum + Number(m[1] || 0),
    0,
  );

  return {
    discovered,
    downloaded: downloaded || pageTotal,
    uploaded: uploaded || pageTotal,
    success: success || uploaded || downloaded || pageTotal,
    skipped,
    failed,
  };
}

/** @deprecated Use parseFetchRunStats */
export function parseDownloadCounts(output: string): { downloaded: number; uploaded: number } {
  const stats = parseFetchRunStats(output);
  return { downloaded: stats.downloaded, uploaded: stats.uploaded };
}

export function isLoginOrBotError(message: string): boolean {
  return /cloudflare|security verification|not a bot|ray id:|session expired|not logged in|login required|manual login/i.test(
    message,
  );
}

export function mapErrorToJobStatus(message: string): "needs_login" | "failed" {
  return isLoginOrBotError(message) ? "needs_login" : "failed";
}
