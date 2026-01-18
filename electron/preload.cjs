// electron/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dotAPI", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // ✅ בדיקת עדכונים ידנית מה-UI
  checkUpdates: () => ipcRenderer.invoke("check-updates"),

  // ✅ מאזינים לאירועי עדכונים מה-main
  onUpdateAvailable: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = () => cb();
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },

  onUpdateDownloaded: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = () => cb();
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },

  onUpdateDownloadProgress: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update-download-progress", handler);
    return () => ipcRenderer.removeListener("update-download-progress", handler);
  },
});
