const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { createStatusTracker } = require("./statusFromLogs.cjs");

let mainWindow = null;
let agentProcess = null;
const statusTracker = createStatusTracker();

/**
 * On Windows child.kill() only ends the agent, orphaning the tsx download
 * child and its Chrome window. taskkill /T ends the whole tree.
 */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // fall through to plain kill
    }
  }
  try {
    child.kill();
  } catch {
    // already dead
  }
}

function agentRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agent");
  }
  return path.resolve(__dirname, "..");
}

function userEnvPath() {
  return path.join(app.getPath("userData"), ".env.local");
}

function teamDefaultsPath() {
  const bundled = path.join(agentRoot(), "config", "team.defaults.env");
  if (fs.existsSync(bundled)) return bundled;
  return path.join(agentRoot(), "config", "team.defaults.env.example");
}

function parseEnv(content) {
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

function isPlaceholderSupabaseUrl(url) {
  const u = (url || "").trim().toLowerCase();
  return !u || u.includes("your-project.supabase.co") || u.includes("example.supabase.co");
}

function isUsableSupabaseConfig(vars) {
  return Boolean(
    vars.SUPABASE_URL &&
      vars.SUPABASE_ANON_KEY &&
      !isPlaceholderSupabaseUrl(vars.SUPABASE_URL),
  );
}

function serializeUserEnv(email) {
  // Never persist Supabase in AppData — installer team.defaults.env is the source of truth.
  // Stale prod URL/key here previously kept overriding hiring_dev installs.
  return [
    "# Perfect Ventures Fetch Agent — user preferences",
    "# Supabase URL/key come from the installer (resources/agent/config/team.defaults.env).",
    `COMPANION_PORTAL_USER_EMAIL=${email || ""}`,
    "COMPANION_POLL_INTERVAL_MS=5000",
    "COMPANION_HEARTBEAT_INTERVAL_MS=30000",
    "",
  ].join("\n");
}

function loadConfig() {
  const vars = {};
  if (fs.existsSync(teamDefaultsPath())) {
    Object.assign(vars, parseEnv(fs.readFileSync(teamDefaultsPath(), "utf8")));
  }
  // Dev / unpackaged: also read repo .env and .env.local (same as CLI agent).
  if (!app.isPackaged) {
    for (const name of [".env", ".env.local"]) {
      const p = path.join(agentRoot(), name);
      if (fs.existsSync(p)) {
        Object.assign(vars, parseEnv(fs.readFileSync(p, "utf8")));
      }
    }
  }
  if (fs.existsSync(userEnvPath())) {
    const user = parseEnv(fs.readFileSync(userEnvPath(), "utf8"));
    // Packaged app: only take email from AppData — never Supabase (avoids prod sticky prefs).
    if (user.COMPANION_PORTAL_USER_EMAIL) {
      vars.COMPANION_PORTAL_USER_EMAIL = user.COMPANION_PORTAL_USER_EMAIL;
    }
    if (!app.isPackaged) {
      if (user.SUPABASE_URL && !isPlaceholderSupabaseUrl(user.SUPABASE_URL)) {
        vars.SUPABASE_URL = user.SUPABASE_URL;
      }
      if (user.SUPABASE_ANON_KEY) {
        vars.SUPABASE_ANON_KEY = user.SUPABASE_ANON_KEY;
      }
    }
  }
  return vars;
}

function saveUserEmail(email) {
  const normalized = email.trim().toLowerCase();
  fs.mkdirSync(path.dirname(userEnvPath()), { recursive: true });
  fs.writeFileSync(userEnvPath(), serializeUserEnv(normalized), "utf8");
}

function agentEnv() {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    FETCH_AGENT_ROOT: agentRoot(),
    FETCH_AGENT_USER_DATA: app.getPath("userData"),
    PLAYWRIGHT_BROWSERS_PATH: "",
  };
}

function tsxCli() {
  return path.join(agentRoot(), "node_modules", "tsx", "dist", "cli.mjs");
}

function emitStatus(snapshot) {
  if (!snapshot) return;
  mainWindow?.webContents.send("status", snapshot);
}

function pipeOutput(chunk) {
  const text = chunk.toString();
  mainWindow?.webContents.send("log", text);
  process.stdout.write(text);
  const next = statusTracker.ingest(text);
  if (next) emitStatus(next);
}

function spawnAgentScript(scriptRel, label) {
  return new Promise((resolve, reject) => {
    const cli = tsxCli();
    const script = path.join(agentRoot(), scriptRel);
    if (!fs.existsSync(cli) || !fs.existsSync(script)) {
      reject(new Error(`Agent files missing. Reinstall the app.`));
      return;
    }

    const child = spawn(process.execPath, [cli, script], {
      cwd: agentRoot(),
      env: agentEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", pipeOutput);
    child.stderr.on("data", pipeOutput);
    child.on("error", reject);
    child.on("close", (code) => {
      if (label === "Agent") {
        agentProcess = null;
        const cleanExit = code === 0 || code === null || code === 15 || code === 143;
        emitStatus(statusTracker.setPhase(
          cleanExit ? "stopped" : "error",
          cleanExit ? "Agent stopped" : `Agent exited unexpectedly (code ${code})`,
        ));
        mainWindow?.webContents.send("agent-stopped");
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });

    if (label === "Agent") {
      agentProcess = child;
      emitStatus(statusTracker.setPhase("starting", "Starting agent…"));
      mainWindow?.webContents.send("agent-started");
      resolve();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    title: "Perfect Ventures Fetch Agent",
    backgroundColor: "#e8edf3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  killTree(agentProcess);
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killTree(agentProcess);
});

ipcMain.handle("get-config", () => {
  const cfg = loadConfig();
  return {
    email: cfg.COMPANION_PORTAL_USER_EMAIL || "",
    supabaseConfigured: isUsableSupabaseConfig(cfg),
    packaged: app.isPackaged,
    agentRoot: agentRoot(),
    status: statusTracker.getState(),
    running: Boolean(agentProcess),
  };
});

ipcMain.handle("save-email", (_e, email) => {
  if (!email?.trim()) throw new Error("Portal email is required");
  saveUserEmail(email);
  return loadConfig().COMPANION_PORTAL_USER_EMAIL;
});

ipcMain.handle("start-agent", async () => {
  if (agentProcess) throw new Error("Agent is already running");
  const cfg = loadConfig();
  if (!isUsableSupabaseConfig(cfg)) {
    throw new Error("Supabase not configured in this build");
  }
  if (!cfg.COMPANION_PORTAL_USER_EMAIL?.trim()) {
    throw new Error("Enter your Caliber portal email first");
  }
  statusTracker.reset("Starting agent…");
  emitStatus(statusTracker.getState());
  await spawnAgentScript("src/main.ts", "Agent");
});

ipcMain.handle("stop-agent", () => {
  if (agentProcess) {
    killTree(agentProcess);
    agentProcess = null;
  }
  emitStatus(statusTracker.setPhase("stopped", "Agent stopped"));
});

ipcMain.handle("login-instahyre", async () => {
  emitStatus(statusTracker.setPhase("login", "Opening Instahyre login in Chrome…"));
  try {
    await spawnAgentScript("src/scripts/login-instahyre.ts", "Instahyre login");
    emitStatus(statusTracker.setPhase(
      agentProcess ? "ready" : "stopped",
      "Instahyre login finished",
    ));
  } catch (err) {
    emitStatus(statusTracker.setPhase("error", err.message || "Instahyre login failed"));
    throw err;
  }
});

ipcMain.handle("login-naukri", async () => {
  emitStatus(statusTracker.setPhase("login", "Opening Naukri login in Chrome…"));
  try {
    await spawnAgentScript("src/scripts/login-naukri.ts", "Naukri login");
    emitStatus(statusTracker.setPhase(
      agentProcess ? "ready" : "stopped",
      "Naukri login finished",
    ));
  } catch (err) {
    emitStatus(statusTracker.setPhase("error", err.message || "Naukri login failed"));
    throw err;
  }
});

ipcMain.handle("open-perfect-ventures-folder", () => {
  const dir = path.join(require("node:os").homedir(), "PerfectVentures");
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});
