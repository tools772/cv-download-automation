const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

let mainWindow = null;
let agentProcess = null;

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

function serializeEnv(vars) {
  return [
    "# Perfect Ventures Fetch Agent",
    `SUPABASE_URL=${vars.SUPABASE_URL || ""}`,
    `SUPABASE_ANON_KEY=${vars.SUPABASE_ANON_KEY || ""}`,
    `COMPANION_PORTAL_USER_EMAIL=${vars.COMPANION_PORTAL_USER_EMAIL || ""}`,
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
  if (fs.existsSync(userEnvPath())) {
    Object.assign(vars, parseEnv(fs.readFileSync(userEnvPath(), "utf8")));
  }
  return vars;
}

function saveUserEmail(email) {
  const vars = loadConfig();
  vars.COMPANION_PORTAL_USER_EMAIL = email.trim().toLowerCase();
  fs.mkdirSync(path.dirname(userEnvPath()), { recursive: true });
  fs.writeFileSync(userEnvPath(), serializeEnv(vars), "utf8");
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

    const append = (chunk) => {
      const text = chunk.toString();
      mainWindow?.webContents.send("log", text);
      process.stdout.write(text);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });

    if (label === "Agent") {
      agentProcess = child;
      child.on("close", () => {
        agentProcess = null;
        mainWindow?.webContents.send("agent-stopped");
      });
      mainWindow?.webContents.send("agent-started");
      resolve();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 520,
    minHeight: 420,
    title: "Perfect Ventures Fetch Agent",
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
  if (agentProcess) agentProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (agentProcess) agentProcess.kill();
});

ipcMain.handle("get-config", () => {
  const cfg = loadConfig();
  return {
    email: cfg.COMPANION_PORTAL_USER_EMAIL || "",
    supabaseConfigured: Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY),
    packaged: app.isPackaged,
    agentRoot: agentRoot(),
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
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    throw new Error("Supabase not configured in this build");
  }
  if (!cfg.COMPANION_PORTAL_USER_EMAIL?.trim()) {
    throw new Error("Enter your Caliber portal email first");
  }
  await spawnAgentScript("src/main.ts", "Agent");
});

ipcMain.handle("stop-agent", () => {
  if (agentProcess) {
    agentProcess.kill("SIGTERM");
    agentProcess = null;
  }
});

ipcMain.handle("login-instahyre", () => spawnAgentScript("src/scripts/login-instahyre.ts", "Instahyre login"));
ipcMain.handle("login-naukri", () => spawnAgentScript("src/scripts/login-naukri.ts", "Naukri login"));

ipcMain.handle("open-perfect-ventures-folder", () => {
  const dir = path.join(require("node:os").homedir(), "PerfectVentures");
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});
