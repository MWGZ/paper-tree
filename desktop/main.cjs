const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  utilityProcess,
} = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_ROOT = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(APP_ROOT, "app", "server.mjs");
let USER_DATA = "";

function dataDir() {
  if (!USER_DATA) {
    try {
      USER_DATA = app.getPath("userData");
    } catch {
      USER_DATA = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || APP_ROOT, "PaperTree");
    }
  }
  return USER_DATA;
}

function configFile() {
  return path.join(dataDir(), "config.json");
}

function dataFile() {
  return path.join(dataDir(), "db.json");
}

function logFile() {
  return path.join(dataDir(), "server.log");
}

let mainWindow = null;
let serverProc = null;
let serverPort = 0;
let starting = false;
let restarting = false;
let quitting = false;

function ensureUserData() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function log(kind, text) {
  try {
    ensureUserData();
    const line = `[${new Date().toISOString()}] [${kind}] ${String(text).trim()}\n`;
    fs.appendFileSync(logFile(), line, "utf8");
  } catch {
    // ignore logging failures
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  ensureUserData();
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), "utf8");
}

function readStoredKey() {
  const cfg = readConfig();
  if (cfg.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, "base64"));
    } catch (err) {
      log("KEY", `decrypt failed: ${err.message}`);
    }
  }
  if (cfg.apiKey) return String(cfg.apiKey);
  return "";
}

function getApiKey() {
  return readStoredKey() || process.env.DEEPSEEK_API_KEY || "";
}

function storeApiKey(key) {
  const clean = String(key || "").trim();
  const cfg = readConfig();
  delete cfg.apiKey;
  delete cfg.apiKeyEnc;
  if (clean) {
    if (safeStorage.isEncryptionAvailable()) {
      cfg.apiKeyEnc = safeStorage.encryptString(clean).toString("base64");
    } else {
      cfg.apiKey = clean;
    }
  }
  writeConfig(cfg);
  return clean;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 900 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(port, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) return resolve();
    const proc = serverProc;
    serverProc = null;
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      resolve();
    }, 1800);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function startServer(preferredPort = 0) {
  await stopServer();
  serverPort = preferredPort || (await findFreePort());
  const key = getApiKey();
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(serverPort),
    DATA_FILE: dataFile(),
    DEMO: key ? "0" : "1",
    DEEPSEEK_API_KEY: key,
    OPENALEX_MAILTO: process.env.OPENALEX_MAILTO || "paper-tree@local",
    NODE_ENV: "production",
  };

  log("SERVER", `starting on ${serverPort} (${key ? "live" : "demo"})`);
  serverProc = utilityProcess.fork(SERVER_ENTRY, [], {
    env,
    cwd: APP_ROOT,
    stdio: "pipe",
  });
  serverProc.stdout?.on("data", (d) => log("OUT", d.toString()));
  serverProc.stderr?.on("data", (d) => log("ERR", d.toString()));
  serverProc.on("exit", (code) => {
    log("SERVER", `exited with code ${code}`);
    if (!restarting && !quitting && mainWindow) {
      // 服务意外退出时，不让 UI 停在半截状态
      dialog.showErrorBox(
        "本地检索服务已停止",
        `PaperTree 的本地服务意外退出（code ${code}）。\n\n日志：${logFile()}\n\n请重启应用；如果反复出现，把日志发给我。`
      );
    }
  });

  const ok = await waitForHealth(serverPort);
  if (!ok) {
    await stopServer();
    throw new Error(`本地服务启动超时。日志：${logFile()}`);
  }
  return serverPort;
}

async function restartServer() {
  if (starting) return;
  starting = true;
  restarting = true;
  const oldPort = serverPort;
  try {
    try {
      await startServer(oldPort);
    } catch (err) {
      log("SERVER", `restart on ${oldPort} failed: ${err.message}; picking a new port`);
      await startServer();
    }
    if (mainWindow && serverPort !== oldPort) {
      await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
    }
  } finally {
    restarting = false;
    starting = false;
  }
}

function registerIpc() {
  ipcMain.handle("app:info", () => {
    const key = getApiKey();
    return {
      isDesktop: true,
      hasKey: Boolean(key),
      mode: key ? "live" : "demo",
      dataDir: dataDir(),
      logFile: logFile(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle("app:set-api-key", async (_event, key) => {
    const clean = storeApiKey(key);
    log("KEY", clean ? "saved" : "cleared");
    await restartServer();
    return { ok: true, hasKey: Boolean(clean) };
  });

  ipcMain.handle("app:restart", async () => {
    await restartServer();
    return { ok: true };
  });

  ipcMain.handle("app:open-data-dir", async () => {
    await shell.openPath(dataDir());
    return { ok: true };
  });
}

function buildMenu() {
  const template = [
    {
      label: "PaperTree",
      submenu: [
        {
          label: "打开数据目录",
          click: () => shell.openPath(dataDir()),
        },
        {
          label: "打开日志",
          click: () => shell.openPath(logFile()),
        },
        { type: "separator" },
        { role: "reload", label: "重新加载界面" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "quit", label: "退出 PaperTree" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "resetZoom", label: "重置缩放" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: "PaperTree",
    backgroundColor: "#f6f3ec",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

app.whenReady().then(async () => {
  ensureUserData();
  app.setAppUserModelId("com.papertree.app");
  registerIpc();
  buildMenu();
  try {
    await createWindow();
  } catch (err) {
    log("FATAL", err.stack || err.message);
    dialog.showErrorBox(
      "PaperTree 启动失败",
      `${err.message}\n\n日志：${logFile()}`
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => log("FATAL", err.stack || err.message));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  await stopServer();
  app.exit(0);
});
