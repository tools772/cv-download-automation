const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fetchAgent", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveEmail: (email) => ipcRenderer.invoke("save-email", email),
  startAgent: () => ipcRenderer.invoke("start-agent"),
  stopAgent: () => ipcRenderer.invoke("stop-agent"),
  loginInstahyre: () => ipcRenderer.invoke("login-instahyre"),
  loginNaukri: () => ipcRenderer.invoke("login-naukri"),
  openSessionsFolder: () => ipcRenderer.invoke("open-perfect-ventures-folder"),
  onLog: (cb) => ipcRenderer.on("log", (_e, text) => cb(text)),
  onStatus: (cb) => ipcRenderer.on("status", (_e, status) => cb(status)),
  onAgentStarted: (cb) => ipcRenderer.on("agent-started", () => cb()),
  onAgentStopped: (cb) => ipcRenderer.on("agent-stopped", () => cb()),
});
