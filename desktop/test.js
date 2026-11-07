/*
 * Проверка правил приложения без Electron: подменяем модуль electron заглушкой.
 *   node test.js
 */
"use strict";
const Module = require("module");
const path = require("path");
const assert = require("assert");

const calls = { external: [], loadFile: [], loadURL: [], hidden: 0, shown: 0, flashed: 0, login: [] };
let ready;
const handlers = {};
const ipc = {};
const fakeWc = () => {
  const on = {};
  return {
    on: (n, fn) => { on[n] = fn; }, emit: (n, ...a) => on[n] && on[n](...a),
    setWindowOpenHandler(fn) { this.open = fn; },
    loadFile: (f, o) => { calls.loadFile.push([f, o]); return Promise.resolve(); },
    getURL: () => "https://beemes.ru/web/", replaceMisspelling() {}, reload() {},
  };
};
class FakeWindow {
  constructor(opts) { this.opts = opts; this.webContents = fakeWc(); this.webContents.executeJavaScript = (code) => { calls.js = (calls.js || []).concat(code); return Promise.resolve(); }; this.ev = {}; electron.lastWindow = this; }
  on(n, fn) { this.ev[n] = fn; } once() {} maximize() {} loadURL(u) { calls.loadURL.push(u); }
  isDestroyed() { return false; } isMinimized() { return false; } restore() {} isMaximized() { return false; } getNormalBounds() { return { width: 1000, height: 700 }; }
  hide() { calls.hidden++; } show() { calls.shown++; } focus() {} isFocused() { return false; } flashFrame(v) { if (v) calls.flashed++; }
  static fromWebContents() { return null; }
}
const electron = {
  app: {
    requestSingleInstanceLock: () => true, quit() { calls.quit = (calls.quit || 0) + 1; }, on: (n, fn) => { handlers[n] = fn; },
    whenReady: () => ({ then: (fn) => { ready = fn; } }), getPath: () => require("os").tmpdir() + "/beemes-test-" + process.pid,
    getVersion: () => "1.0.0", setAppUserModelId() {},
    setLoginItemSettings: (s) => calls.login.push(s), getLoginItemSettings: () => ({ openAtLogin: calls.login.length > 0 && calls.login.at(-1).openAtLogin }),
  },
  BrowserWindow: FakeWindow,
  Menu: { buildFromTemplate: (t) => ({ template: t, popup() {} }), setApplicationMenu(m) { electron.menu = m; } },
  Tray: class { constructor() { electron.tray = this; } setToolTip(t) { this.tip = t; } setContextMenu(m) { this.menu = m; } on(n, fn) { this.click = fn; } },
  Notification: class { static isSupported() { return true; } constructor(o) { electron.note = o; } show() {} },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  ipcMain: { on: (n, fn) => { ipc[n] = fn; } },
  dialog: { showMessageBox() {} },
  shell: { openExternal: (u) => { calls.external.push(u); return Promise.resolve(); } },
  clipboard: { writeText() {} },
  session: { defaultSession: { setPermissionRequestHandler(fn) { electron.permRequest = fn; }, setPermissionCheckHandler(fn) { electron.permCheck = fn; }, flushStorageData() { calls.flushed = (calls.flushed || 0) + 1; } } },
};
require("fs").mkdirSync(electron.app.getPath(), { recursive: true });
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) { return r === "electron" ? "electron" : orig.call(this, r, ...rest); };
require.cache.electron = { id: "electron", filename: "electron", loaded: true, exports: electron };

const main = require(path.join(__dirname, "main.js"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log("OK  ", m); };

ok(main.SITE === "https://beemes.ru/web/" && main.ORIGIN === "https://beemes.ru", "открывает веб-версию beemes");
ok(main.isOurs("https://beemes.ru/call.html#chat=1") && !main.isOurs("https://beemes.ru.evil.ru/"), "свой сайт отличает от похожих");
ready();
ok(calls.loadURL[0] === main.SITE, "при запуске открывается beemes");
ok(electron.tray && electron.tray.tip === "beemes", "значок в трее");
ok(calls.login.length === 1 && calls.login[0].openAtLogin === true && calls.login[0].args.includes("--hidden"), "при первом запуске включён автозапуск (тихо, в трей)");
const trayItems = electron.tray.menu.template.map((i) => i.label).filter(Boolean);
ok(trayItems.includes("Открыть beemes") && trayItems.includes("Запускать вместе с Windows") && trayItems.includes("Выйти"), "меню трея: открыть, автозапуск, выйти");

const w = electron.lastWindow;
let prevented = false;
w.ev.close({ preventDefault: () => { prevented = true; } });
ok(prevented && calls.hidden === 1, "закрытие окна — прячет в трей, а не выходит");
ok(electron.note && /в фоне/.test(electron.note.title), "один раз подсказывает, что beemes работает в фоне");
ipc["beemes:show"]();
ok(calls.shown >= 1, "уведомление/звонок достаёт окно из трея");
w.ev["page-title-updated"]({}, "(3) beemes");
ok(calls.flashed === 1 && electron.tray.tip.includes("3"), "новые сообщения: мигает кнопка на панели задач, число в подсказке трея");
w.ev["page-title-updated"]({}, "(3) beemes");
ok(calls.flashed === 1, "не мигает повторно без новых сообщений");

const ask = (perm, url) => new Promise((res) => electron.permRequest(null, perm, res, { requestingUrl: url }));
(async () => {
  ok(await ask("media", "https://beemes.ru/call.html") === true, "микрофон и камера для звонков разрешены beemes");
  ok(await ask("notifications", "https://beemes.ru/web/") === true, "уведомления разрешены beemes");
  ok(await ask("media", "https://evil.example/") === false && await ask("geolocation", main.SITE) === false, "чужим и лишнего — нет");
  ok(electron.permCheck(null, "notifications", "https://beemes.ru/") === true && electron.permCheck(null, "notifications", "https://beemes.ru") === true, "проверка уведомлений: адрес с «/» на конце и без");
  ok(electron.permCheck(null, "notifications", "https://evil.example/") === false, "чужому сайту уведомления нельзя");
  const wc = fakeWc();
  handlers["web-contents-created"](null, wc);
  const call = wc.open({ url: "https://beemes.ru/call.html#chat=1&video=1" });
  ok(call.action === "allow" && call.overrideBrowserWindowOptions.width === 460, "окно звонка открывается внутри приложения");
  ok(wc.open({ url: "https://example.com/" }).action === "deny" && calls.external.includes("https://example.com/"), "ссылки на другие сайты — в браузере");
  wc.emit("did-fail-load", {}, -106, "ERR_INTERNET_DISCONNECTED", main.SITE, true);
  ok(calls.loadFile.at(-1)[0].endsWith("offline.html"), "без интернета — экран «Нет связи»");
  const before = calls.flushed || 0;
  ipc["beemes:flush"]();
  w.ev.hide();
  let held = false;
  handlers["before-quit"]({ preventDefault: () => { held = true; } });
  ok((calls.flushed || 0) - before === 3, "вход записывается на диск сразу: по просьбе страницы, при сворачивании и перед выходом");
  ok(held && (calls.js || []).some((c) => c.includes("beemesPresenceOffline")), "перед выходом — сначала «не в сети» (собеседники видят сразу)");
  await new Promise((r) => setTimeout(r, 20));
  ok(calls.quit === 1, "после ответа сервера приложение выходит");
  let heldAgain = false;
  handlers["before-quit"]({ preventDefault: () => { heldAgain = true; } });
  ok(!heldAgain, "второй раз выход не задерживается");
  console.log(`\n${n} checks, 0 fails`);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
