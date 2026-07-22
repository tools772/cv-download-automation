const emailInput = document.getElementById("email");
const logEl = document.getElementById("log");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const hintEl = document.getElementById("config-hint");

function appendLog(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

async function init() {
  const cfg = await window.fetchAgent.getConfig();
  emailInput.value = cfg.email || "";
  hintEl.textContent = cfg.supabaseConfigured
    ? "Supabase pre-configured in this installer."
    : "Warning: Supabase not configured — contact IT.";

  window.fetchAgent.onLog(appendLog);
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

init();
