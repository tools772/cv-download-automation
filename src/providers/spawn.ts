import { spawn } from "node:child_process";

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runNpmScript(
  cwd: string,
  script: string,
  env: Record<string, string>,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", script, "--silent"], {
      cwd,
      env: { ...process.env, ...env, PLAYWRIGHT_BROWSERS_PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function parseDownloadCounts(output: string): { downloaded: number; uploaded: number } {
  const combined = output;
  const uploadedMatch = combined.match(/totalUploadedToDrive[=:\s]+(\d+)/i);
  const downloadedMatch = combined.match(/totalResumesDownloaded[=:\s]+(\d+)/i);
  const pageMatches = [...combined.matchAll(/status=downloaded\s*\|\s*count=(\d+)/gi)];
  const pageTotal = pageMatches.reduce((sum, m) => sum + Number(m[1] || 0), 0);
  const naukriMatch = combined.match(/Downloaded\s+(\d+)\s+CV/i);

  return {
    downloaded: downloadedMatch
      ? Number(downloadedMatch[1])
      : naukriMatch
        ? Number(naukriMatch[1])
        : pageTotal,
    uploaded: uploadedMatch ? Number(uploadedMatch[1]) : pageTotal,
  };
}

export function isLoginOrBotError(message: string): boolean {
  return /cloudflare|security verification|not a bot|ray id:|session expired|not logged in|login required|manual login/i.test(
    message,
  );
}

export function mapErrorToJobStatus(message: string): "needs_login" | "failed" {
  return isLoginOrBotError(message) ? "needs_login" : "failed";
}
