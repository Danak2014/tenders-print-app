// electron/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dotAPI", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
