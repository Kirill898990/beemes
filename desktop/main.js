/*
 * beemes для Windows: окно с веб-версией beemes (сервер/web/).
 *
 * Чаты, шифрование, эмодзи, фото и звонки — это веб-версия, поэтому приложение обновляется вместе с сайтом.
 * Здесь то, что нужно мессенджеру на компьютере: своё окно и значок, работа в трее (сообщения и звонки
 * приходят, даже когда окно закрыто), мигание кнопки на панели задач, запуск вместе с Windows,
 * микрофон и камера для звонков, экран «Нет связи».
 */
"use strict";

const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const SITE = process.env.BEEMES_URL || "https://kbast.ru/web/";
const ORIGIN = new URL(SITE).origin;
const TITLE = "beemes";
const ICON = path.join(__dirname, "icon.png");
const OFFLINE = path.join(__dirname, "offline.html");

const isOurs = (url) => { try { return new URL(url).origin === ORIGIN; } catch (_) { return false; } };
const isOffline = (url) => typeof url === "string" && url.startsWith("file:") && decodeURIComponent(url).includes("offline.html");
const openOutside = (url) => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {}); };

const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

let win = null;
let tray = null;
let quitting = false;
let unread = 0;

// ---------- Окно запоминает размер ----------
const stateFile = () => path.join(app.getPath("userData"), "window.json");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return def; } };
const writeJson = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch (_) { /* не страшно */ } };
function saveState() {
  if (!win || win.isDestroyed()) return;
  writeJson(stateFile(), { ...win.getNormalBounds(), maximized: win.isMaximized() });
}

// ---------- Разрешения: микрофон, камера, уведомления — только нашему сайту ----------
const ALLOWED = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen"]);
function setupPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || "";
    callback(isOurs(url) && ALLOWED.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => requestingOrigin === ORIGIN && ALLOWED.has(permission));
}

function contextMenu(wc, params) {
  const items = [];
  if (params.misspelledWord && params.dictionarySuggestions.length) {
    for (const w of params.dictionarySuggestions.slice(0, 5)) items.push({ label: w, click: () => wc.replaceMisspelling(w) });
    items.push({ type: "separator" });
  }
  if (params.linkURL && !params.linkURL.startsWith("blob:")) {
    items.push({ label: "Открыть ссылку в браузере", click: () => openOutside(params.linkURL) });
    items.push({ label: "Копировать ссылку", click: () => require("electron").clipboard.writeText(params.linkURL) });
    items.push({ type: "separator" });
  }
  if (params.isEditable) {
    items.push(
      { label: "Отменить", role: "undo", enabled: params.editFlags.canUndo },
      { type: "separator" },
      { label: "Вырезать", role: "cut", enabled: params.editFlags.canCut },
      { label: "Копировать", role: "copy", enabled: params.editFlags.canCopy },
      { label: "Вставить", role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: "Выделить всё", role: "selectAll" },
    );
  } else if (params.selectionText && params.selectionText.trim()) items.push({ label: "Копировать", role: "copy" });
  if (items.length && items[items.length - 1].type === "separator") items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) || undefined });
}

/** Правила для каждой страницы: главное окно и окно звонка. */
function guard(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) {
      // окно звонка
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 460, height: 800, minWidth: 360, minHeight: 520, autoHideMenuBar: true, backgroundColor: "#15121F", icon: ICON, title: "Звонок · beemes",
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
        },
      };
    }
    openOutside(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (isOurs(url) || isOffline(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  wc.on("context-menu", (_e, params) => contextMenu(wc, params));
  wc.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || isOffline(url)) return;
    wc.loadFile(OFFLINE, { query: { u: url && isOurs(url) ? url : SITE } }).catch(() => {});
  });
}

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const state = readJson(stateFile(), { width: 1180, height: 800 });
  win = new BrowserWindow({
    width: state.width >= 500 ? state.width : 1180, height: state.height >= 400 ? state.height : 800, x: state.x, y: state.y,
    minWidth: 380, minHeight: 520, title: TITLE, icon: ICON, backgroundColor: "#15121F", autoHideMenuBar: true,
    show: !process.argv.includes("--hidden"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, preload: path.join(__dirname, "preload.js") },
  });
  if (state.maximized) win.maximize();
  // Закрыли окно — beemes остаётся в трее, чтобы приходили сообщения и звонки.
  win.on("close", (e) => {
    saveState();
    if (quitting) return;
    e.preventDefault();
    win.hide();
    const s = readJson(settingsFile(), {});
    if (!s.trayHintShown && Notification.isSupported()) {
      new Notification({ title: "beemes работает в фоне", body: "Сообщения и звонки будут приходить. Выйти совсем — через значок пчёлки возле часов.", icon: ICON }).show();
      writeJson(settingsFile(), { ...s, trayHintShown: true });
    }
  });
  win.on("closed", () => { win = null; });
  // Число непрочитанных страница пишет в заголовке: «(3) beemes».
  win.on("page-title-updated", (_e, title) => {
    const m = /^\((\d+)\)/.exec(title);
    const n = m ? Number(m[1]) : 0;
    if (n > unread && !win.isFocused()) win.flashFrame(true);
    unread = n;
    if (tray) tray.setToolTip(n ? `beemes — непрочитанных: ${n}` : "beemes");
  });
  win.on("focus", () => win.flashFrame(false));
  win.loadURL(SITE);
}

function startWithWindows(enable) {
  app.setLoginItemSettings({ openAtLogin: enable, args: ["--hidden"] });
}

function trayMenu() {
  const auto = app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin;
  return Menu.buildFromTemplate([
    { label: "Открыть beemes", click: show },
    { type: "separator" },
    { label: "Запускать вместе с Windows", type: "checkbox", checked: auto, click: (item) => { startWithWindows(item.checked); tray.setContextMenu(trayMenu()); } },
    { type: "separator" },
    { label: "Выйти", click: () => { quitting = true; app.quit(); } },
  ]);
}

function appMenu() {
  return Menu.buildFromTemplate([
    {
      label: "beemes",
      submenu: [
        { label: "Обновить", accelerator: "F5", click: () => win && win.webContents.reload() },
        { label: "Обновить", accelerator: "CmdOrCtrl+R", click: () => win && win.webContents.reload(), visible: false },
        { type: "separator" },
        { label: "Свернуть в трей", accelerator: "CmdOrCtrl+W", click: () => win && win.hide() },
        { label: "Выйти", accelerator: "CmdOrCtrl+Q", click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { label: "Отменить", role: "undo" }, { label: "Повторить", role: "redo" }, { type: "separator" },
        { label: "Вырезать", role: "cut" }, { label: "Копировать", role: "copy" }, { label: "Вставить", role: "paste" }, { label: "Выделить всё", role: "selectAll" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { label: "Крупнее", role: "zoomIn", accelerator: "CmdOrCtrl+=" }, { label: "Мельче", role: "zoomOut" }, { label: "Обычный размер", role: "resetZoom" },
        { type: "separator" }, { label: "Во весь экран", role: "togglefullscreen" },
      ],
    },
    {
      label: "Справка",
      submenu: [
        { label: "Открыть beemes в браузере", click: () => openOutside(SITE) },
        { label: "О программе", click: () => dialog.showMessageBox(win, { type: "info", title: "О программе", message: "beemes для Windows", detail: `Версия ${app.getVersion()}\nМессенджер с живыми эмодзи и шифрованием.` }) },
      ],
    },
  ]);
}

app.on("web-contents-created", (_e, wc) => guard(wc));
app.on("second-instance", show);
app.on("before-quit", () => { quitting = true; });
ipcMain.on("beemes:show", show);

if (firstInstance) app.whenReady().then(() => {
  app.setAppUserModelId("ru.beemes.desktop");
  setupPermissions(session.defaultSession);
  Menu.setApplicationMenu(appMenu());
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("beemes");
  tray.setContextMenu(trayMenu());
  tray.on("click", show);
  // Первый запуск: включаем автозапуск (выключить — в меню значка в трее).
  const s = readJson(settingsFile(), {});
  if (!s.autoStartSet) { startWithWindows(true); writeJson(settingsFile(), { ...s, autoStartSet: true }); tray.setContextMenu(trayMenu()); }
  createWindow();
});

app.on("window-all-closed", () => { /* остаёмся в трее */ });

module.exports = { isOurs, isOffline, ORIGIN, SITE };
