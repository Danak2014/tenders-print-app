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
   ✅ כולל ולידציה כדי למנוע javascript:/file:/וכד'
====================================================== */
ipcMain.handle("open-external", async (_event, url) => {
  try {
    const raw = (url ?? "").toString().trim();
    if (!raw) return false;

    const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

    let parsed;
    try {
      parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    } catch {
      try {
        parsed = new URL(raw);
      } catch {
        return false;
      }
    }

    if (!allowedProtocols.has(parsed.protocol)) return false;

    await shell.openExternal(parsed.toString());
    return true;
  } catch (e) {
    log.error("open-external failed:", e);
    return false;
  }
});

/* ======================================================
   IPC – החזרת גרסת אפליקציה (renderer → main)
====================================================== */
ipcMain.handle("get-app-version", async () => {
  try {
    return app.getVersion();
  } catch (e) {
    log.error("get-app-version failed:", e);
    return "";
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

async function waitForServerReady(timeoutMs = 25000) {
  const start = Date.now();
  const url = `http://localhost:${SERVER_PORT}/api/tenders?q=test`;

  while (Date.now() - start < timeoutMs) {
    // אם השרת כבר נפל – לא מחכים סתם עד timeout
    if (serverProcess && serverProcess.exitCode != null) {
      throw new Error(`Server exited early (code: ${serverProcess.exitCode})`);
    }

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
   ✅ PROD: מריצים מתוך app.asar (app.getAppPath()) כדי שימצא node_modules
   ✅ DEV : מריצים מתוך תיקיית הפרויקט
====================================================== */
function resolveServerPath() {
  // app.getAppPath() מצביע:
  // DEV -> תיקיית הפרויקט
  // PROD -> .../resources/app.asar
  return path.join(app.getAppPath(), "server.cjs");
}

function startServer() {
  const serverPath = resolveServerPath();

  log.info("Starting server:", serverPath);

  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: app.getAppPath(), // ✅ חשוב במיוחד בפרוד
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(SERVER_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout?.on("data", (buf) => {
    log.info("[server stdout]", buf.toString());
  });

  serverProcess.stderr?.on("data", (buf) => {
    log.error("[server stderr]", buf.toString());
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
    const isAppUrl = url.startsWith(DEV_URL) || url.startsWith("file://") || url === current;

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

  // לא מורידים אוטומטית בלי לשאול
  autoUpdater.autoDownload = false;

  autoUpdater.on("error", (err) => {
    log.error("AutoUpdater error:", err);
  });

  autoUpdater.on("update-available", async () => {
    mainWindow?.webContents?.send("update-available");

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
    mainWindow?.webContents?.send("update-not-available");
  });

  autoUpdater.on("download-progress", (p) => {
    const percent = Number(p?.percent || 0);
    log.info(`Download ${percent.toFixed(1)}%`);
    mainWindow?.webContents?.send("update-download-progress", { percent });
  });

  autoUpdater.on("update-downloaded", async () => {
    mainWindow?.webContents?.send("update-downloaded");

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
   IPC – בדיקת עדכונים ידנית (UI → main)
====================================================== */
ipcMain.handle("check-updates", async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    log.error("check-updates failed:", e);
    return { ok: false, error: String(e?.message || e) };
  }
});

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
    // ✅ טוענים את ה-UI מתוך app.asar (בטוח ועקבי)
    const indexHtml = path.join(app.getAppPath(), "dist", "index.html");
    await mainWindow.loadFile(indexHtml);
  } else {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  if (app.isPackaged) {
    setupAutoUpdates();
    autoUpdater.checkForUpdates();
    setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000);
  }
}

/* ======================================================
   Lifecycle
====================================================== */
function stopServer() {
  if (!serverProcess) return;
  try {
    serverProcess.kill();
  } catch {}
  serverProcess = null;
}

app.whenReady().then(() => {
  createWindow().catch(async (err) => {
    log.error("createWindow failed:", err);

    try {
      await dialog.showMessageBox({
        type: "error",
        title: "שגיאת הפעלה",
        message: "האפליקציה לא הצליחה להפעיל את השרת הפנימי.",
        detail: String(err?.message || err),
      });
    } catch {}

    app.quit();
  });
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopServer();
});
