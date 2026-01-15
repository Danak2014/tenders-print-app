// electron/main.cjs

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let mainWindow = null;
let serverProcess = null;

const SERVER_PORT = 8787;
const DEV_URL = "http://localhost:5173";

/* ======================================================
   IPC – פתיחת קישור חיצוני (renderer → main)
====================================================== */
ipcMain.handle("open-external", async (_event, url) => {
  try {
    if (!url || typeof url !== "string") return false;
    await shell.openExternal(url);
    return true;
  } catch (e) {
    log.error("open-external failed:", e);
    return false;
  }
});

/* ======================================================
   עזר: בדיקת זמינות שרת
====================================================== */
function pingServer(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", reject);
    req.setTimeout(1500, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function waitForServerReady(timeoutMs = 20000) {
  const start = Date.now();
  const url = `http://localhost:${SERVER_PORT}/api/tenders?q=test`;

  while (Date.now() - start < timeoutMs) {
    try {
      await pingServer(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  throw new Error("Server did not start in time");
}

/* ======================================================
   הפעלת server.cjs כתהליך Node פנימי
====================================================== */
function startServer() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "app", "server.cjs")
    : path.join(app.getAppPath(), "server.cjs");

  log.info("Starting server:", serverPath);

  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(SERVER_PORT),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  serverProcess.on("exit", (code) => {
    log.warn("Server process exited with code:", code);
    serverProcess = null;
  });
}

/* ======================================================
   קישורים חיצוניים → דפדפן מערכת
====================================================== */
function installExternalLinkHandlers(win) {
  if (!win) return;

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((e) => log.error(e));
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    const isAppUrl =
      url.startsWith(DEV_URL) ||
      url.startsWith("file://") ||
      url === current;

    if (!isAppUrl) {
      event.preventDefault();
      shell.openExternal(url).catch((e) => log.error(e));
    }
  });
}

/* ======================================================
   Auto Update (electron-updater)
====================================================== */
function setupAutoUpdates() {
  log.transports.file.level = "info";
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;

  autoUpdater.on("error", (err) => {
    log.error("AutoUpdater error:", err);
  });

  autoUpdater.on("update-available", async () => {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["להוריד עדכון", "לא עכשיו"],
      defaultId: 0,
      cancelId: 1,
      title: "עדכון זמין",
      message: "קיימת גרסה חדשה של האפליקציה. להוריד עכשיו?",
    });

    if (choice.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No updates available");
  });

  autoUpdater.on("download-progress", (p) => {
    log.info(`Download ${p.percent.toFixed(1)}%`);
  });

  autoUpdater.on("update-downloaded", async () => {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["להתקין עכשיו", "אחר כך"],
      defaultId: 0,
      cancelId: 1,
      title: "העדכון מוכן",
      message: "העדכון ירד. להתקין עכשיו? האפליקציה תופעל מחדש.",
    });

    if (choice.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
}

/* ======================================================
   יצירת חלון ראשי
====================================================== */
async function createWindow() {
  startServer();
  await waitForServerReady();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "מכרזים בענף הדפוס",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  installExternalLinkHandlers(mainWindow);

  if (app.isPackaged) {
    const indexHtml = path.join(
      process.resourcesPath,
      "app",
      "dist",
      "index.html"
    );
    await mainWindow.loadFile(indexHtml);
  } else {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // ✅ Auto Update – רק בגרסה ארוזה
  if (app.isPackaged) {
    setupAutoUpdates();
    autoUpdater.checkForUpdates();
    setInterval(
      () => autoUpdater.checkForUpdates(),
      6 * 60 * 60 * 1000
    );
  }
}

/* ======================================================
   Lifecycle
====================================================== */
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
});
