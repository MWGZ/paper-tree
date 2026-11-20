const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke("app:info"),
  setApiKey: (key) => ipcRenderer.invoke("app:set-api-key", key),
  restart: () => ipcRenderer.invoke("app:restart"),
  openDataDir: () => ipcRenderer.invoke("app:open-data-dir"),
});
