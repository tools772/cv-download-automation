const emailInput = document.getElementById("email");
const logEl = document.getElementById("log");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const hintEl = document.getElementById("config-hint");
const statusPill = document.getElementById("status-pill");
const statusLabel = document.getElementById("status-label");
const statusMessage = document.getElementById("status-message");
const providerBadge = document.getElementById("provider-badge");
const jobBadge = document.getElementById("job-badge");
const activityEl = document.getElementById("activity");

const PHASE_LABELS = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Ready",
  working: "Working",
  login: "Needs login",
  error: "Error",
};

function appendLog(text) {
  logEl.textContent += text;
  if (logEl.textContent.length > 120_000) {
    logEl.textContent = logEl.textContent.slice(-80_000);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function renderActivity(items) {
  if (!items || items.length === 0) {
    activityEl.innerHTML =
      '<li class="activity-empty">Nothing yet — start the agent to see live progress here.</li>';
    return;
  }
  activityEl.innerHTML = items
    .map(
      (item) =>
        `<li class="${item.kind || "info"}">` +
        `<span class="activity-time">${formatTime(item.at)}</span>` +
        `<span>${escapeHtml(item.text)}</span>` +
        `</li>`,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyStatus(status) {
  if (!status) return;

  const phase = status.phase || "stopped";
  statusPill.className = `pill ${phase}`;
  statusLabel.textContent = PHASE_LABELS[phase] || phase;
  statusMessage.textContent = status.message || "";

  if (status.provider) {
    providerBadge.textContent = status.provider;
    providerBadge.classList.remove("hidden");
  } else {
    providerBadge.classList.add("hidden");
  }

  if (status.jobId) {
    jobBadge.textContent = `Job ${status.jobId.slice(0, 8)}…`;
    jobBadge.title = status.jobId;
    jobBadge.classList.remove("hidden");
  } else {
    jobBadge.classList.add("hidden");
  }

  const counts = status.counts || {};
  document.getElementById("count-discovered").textContent = String(counts.discovered || 0);
  document.getElementById("count-downloaded").textContent = String(counts.downloaded || 0);
  document.getElementById("count-uploaded").textContent = String(counts.uploaded || 0);
  document.getElementById("count-failed").textContent = String(counts.failed || 0);

  renderActivity(status.activities || []);
}

async function init() {
  const cfg = await window.fetchAgent.getConfig();
  emailInput.value = cfg.email || "";
  hintEl.textContent = cfg.supabaseConfigured
    ? "Supabase is pre-configured in this installer."
    : "Warning: Supabase not configured — contact IT.";
  hintEl.classList.toggle("warn", !cfg.supabaseConfigured);

  if (cfg.status) applyStatus(cfg.status);
  setRunning(Boolean(cfg.running));

  window.fetchAgent.onLog(appendLog);
  window.fetchAgent.onStatus(applyStatus);
  window.fetchAgent.onAgentStarted(() => setRunning(true));
  window.fetchAgent.onAgentStopped(() => setRunning(false));
}

document.getElementById("save-email").addEventListener("click", async () => {
  try {
    const saved = await window.fetchAgent.saveEmail(emailInput.value);
    emailInput.value = saved;
    appendLog(`\nSaved portal email: ${saved}\n`);
  } catch (err) {
    appendLog(`\nError: ${err.message}\n`);
  }
});

startBtn.addEventListener("click", async () => {
  try {
    await window.fetchAgent.saveEmail(emailInput.value);
    appendLog("\nStarting agent…\n");
    await window.fetchAgent.startAgent();
  } catch (err) {
    appendLog(`\nError: ${err.message}\n`);
    setRunning(false);
  }
});

stopBtn.addEventListener("click", async () => {
  await window.fetchAgent.stopAgent();
  setRunning(false);
  appendLog("\nAgent stopped.\n");
});

document.getElementById("login-in").addEventListener("click", async () => {
  appendLog("\nOpening Instahyre login (Chrome)…\n");
  try {
    await window.fetchAgent.loginInstahyre();
    appendLog("\nInstahyre login finished.\n");
  } catch (err) {
    appendLog(`\nError: ${err.message}\n`);
  }
});

document.getElementById("login-nk").addEventListener("click", async () => {
  appendLog("\nOpening Naukri login (Chrome)…\n");
  try {
    await window.fetchAgent.loginNaukri();
    appendLog("\nNaukri login finished.\n");
  } catch (err) {
    appendLog(`\nError: ${err.message}\n`);
  }
});

document.getElementById("open-sessions").addEventListener("click", () => {
  window.fetchAgent.openSessionsFolder();
});

document.getElementById("clear-activity").addEventListener("click", () => {
  renderActivity([]);
});

init();
