/* beemes в браузере и в приложении для Windows: запуск, раскладка (чаты слева, переписка справа), переходы. */
import * as store from "./store.js";
import * as realtime from "./realtime.js";
import { h, loadEmoji, animoji, icon, disposeEmoji, when } from "./ui.js";
import * as auth from "./views/auth.js";
import { chatList, search } from "./views/chats.js";
import { chatView } from "./views/chat.js";
import { peerProfile, safety } from "./views/profile.js";
import * as settings from "./views/settings.js";
import { checkIncoming, askNotify, canNotify } from "./calls.js";

const app = document.getElementById("app");
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

// ---------- Тема ----------
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = store.theme.get();
  document.documentElement.dataset.theme = t === "system" ? (darkQuery.matches ? "dark" : "light") : t;
}
darkQuery.addEventListener("change", applyTheme);
store.on("theme", applyTheme);
applyTheme();

// ---------- Раскладка ----------
let layout = null;
let currentChat = null;

function ensureLayout() {
  if (layout) return layout;
  const side = h("aside", { class: "sidebar" });
  const pane = h("main", { class: "pane", id: "main" });
  const root = h("div", { class: "layout" }, side, pane);
  app.replaceChildren(h("a", { class: "skip", href: "#main" }, "К переписке"), root);
  layout = { root, side, pane, sideKey: "", paneKey: "", sideOff: null, paneOff: null };
  maybeAskNotify();
  return layout;
}

function emptyPane(root) {
  const el = h("section", { class: "empty-pane" }, h("div", { class: "comb", "aria-hidden": "true" }),
    h("div", { class: "empty-pane-inner" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 120, height: 135 }),
      h("h2", {}, "Выберите, кому написать"),
      h("p", { class: "muted" }, icon("lock", 16), " Сообщения, фото и звонки зашифрованы — прочитать их можете только вы и собеседник.")));
  root.replaceChildren(el);
  return () => disposeEmoji(el);
}

function route() {
  const [a = "", b = ""] = location.hash.replace(/^#\/?/, "").split("/");
  if (!store.state.me) {
    if (layout) { layout.sideOff && layout.sideOff(); layout.paneOff && layout.paneOff(); layout = null; }
    if (a === "login") auth.login(app, go, onSignedIn);
    else if (a === "register") auth.register(app, go, onSignedIn);
    else auth.welcome(app, go);
    return;
  }
  if (["welcome", "login", "register"].includes(a)) { go("#/"); return; }
  const L = ensureLayout();
  currentChat = a === "chat" ? b : null;

  const sideKey = a === "search" ? "search" : a === "settings" ? "settings:" + b : "chats";
  if (sideKey !== L.sideKey) {
    if (L.sideOff) L.sideOff();
    L.sideOff = sideKey === "search" ? search(L.side, { go })
      : sideKey.startsWith("settings") ? settings.menu(L.side, { go, route: b })
        : chatList(L.side, { go, activeChat: () => currentChat });
    L.sideKey = sideKey;
  } else if (sideKey === "chats") store.emit("chats");

  const paneKey = a === "chat" && b ? "chat:" + b : a === "user" && b ? "user:" + b : a === "safety" && b ? "safety:" + b : a === "settings" && b ? "settings:" + b : "empty";
  if (paneKey !== L.paneKey) {
    if (L.paneOff) L.paneOff();
    const [kind, id] = paneKey.split(":");
    L.paneOff = kind === "chat" ? chatView(L.pane, { chatId: id, go })
      : kind === "user" ? peerProfile(L.pane, { userId: id, go })
        : kind === "safety" ? safety(L.pane, { chatId: id, go })
          : kind === "settings" ? ({ profile: settings.myProfile, password: settings.password, blocked: settings.blockedList, about: settings.about }[id] || emptyPane)(L.pane, { go })
            : emptyPane(L.pane);
    L.paneKey = paneKey;
  }
  // На узком экране видна одна колонка: список или открытый раздел.
  L.root.dataset.view = paneKey === "empty" ? "side" : "pane";
}

// ---------- Уведомления: один раз предложить включить ----------
function maybeAskNotify() {
  const asked = () => { try { return localStorage.getItem("bm_notify_asked"); } catch (_) { return "1"; } };
  const remember = () => { try { localStorage.setItem("bm_notify_asked", "1"); } catch (_) { /* ignore */ } };
  if (!canNotify() || Notification.permission !== "default" || asked()) return;
  const bar = h("div", { class: "notify-ask", role: "status" }, icon("bell", 20),
    h("span", {}, "Включить уведомления о новых сообщениях?"),
    h("button", { type: "button", class: "btn btn-primary btn-small", onclick: async () => { bar.remove(); remember(); await askNotify(); } }, "Включить"),
    h("button", { type: "button", class: "icon-btn", "aria-label": "Не сейчас", onclick: () => { bar.remove(); remember(); } }, icon("close", 18)));
  setTimeout(() => document.body.append(bar), 1500);
}

// ---------- После входа ----------
let pinger = null;
let ticker = null;
const visible = () => !document.hidden;
function onSignedIn() {
  realtime.start();
  store.refreshChats().catch(() => {});
  if (visible()) store.presence("online");
  clearInterval(pinger);
  // Пока beemes открыт — «я тут» каждые 20 секунд (сервер держит «в сети» 45 секунд).
  pinger = setInterval(() => { if (visible()) store.presence("online"); }, 20000);
  // Раз в полминуты обновляем «был(а) N мин. назад».
  clearInterval(ticker);
  ticker = setInterval(() => store.emit("users"), 30000);
  checkIncoming();
  if (["#/welcome", "#/login", "#/register", ""].includes(location.hash)) go("#/");
  else route();
}

// Собеседник пропал без «до свидания» (сел телефон, пропал интернет): его «в сети» истекает само —
// перерисовываем ровно в этот момент.
let expiry = null;
function watchExpiry() {
  clearTimeout(expiry);
  const now = Date.now();
  let next = Infinity;
  const look = (u) => { const t = u ? when(u.onlineUntil) : 0; if (t > now && t < next) next = t; };
  store.state.users.forEach(look);
  store.state.chats.forEach((i) => look(i.peer));
  if (next !== Infinity) expiry = setTimeout(() => store.emit("users"), Math.min(next - now + 300, 2147483000));
}
store.on("users", watchExpiry);
store.on("chats", watchExpiry);

store.on("me", (me) => {
  if (!me) {
    realtime.stop();
    clearInterval(pinger);
    clearInterval(ticker);
    clearTimeout(expiry);
    route();
  }
});

// Число непрочитанных — в заголовке вкладки и на значке приложения.
store.on("chats", () => {
  const n = store.state.chats.reduce((s, i) => s + (i.muted ? 0 : i.unread), 0);
  document.title = (n ? `(${n}) ` : "") + "beemes";
  if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
});

// Вернулись в beemes (телефон усыплял страницу, свернули окно, появился интернет): переподключаемся
// и догружаем то, что пришло, пока нас не было, — и список чатов, и открытый чат.
let hiddenAt = 0;
function resume() {
  if (!store.state.me || !store.state.privateKey) return;
  store.presence("online");
  if (hiddenAt && Date.now() - hiddenAt > 20000) realtime.restart(); else realtime.ensure();
  hiddenAt = 0;
  store.refreshChats().catch(() => {});
  if (store.state.openChatId) store.loadMessages(store.state.openChatId).catch(() => {});
}
// Свернули вкладку/окно, ушли с сайта, закрыли приложение — сразу «не в сети».
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); if (store.state.me) store.presence("offline", true); } else resume();
});
window.addEventListener("pagehide", () => { if (store.state.me) store.presence("offline", true); });
window.addEventListener("online", resume);
window.addEventListener("pageshow", (e) => { if (e.persisted) resume(); });
// Приложение для Windows перед выходом просит отметить «не в сети» и ждёт ответа сервера.
window.beemesPresenceOffline = () => (store.state.me ? store.presence("offline") : Promise.resolve());

window.addEventListener("hashchange", route);

(async () => {
  await loadEmoji();
  app.classList.remove("boot");
  const signedIn = await store.restore().catch(() => false);
  if (signedIn === "locked") {
    auth.unlock(app, store.state.me, onSignedIn, async () => { await store.logout(); location.hash = "#/login"; route(); });
  } else if (signedIn) onSignedIn();
  else route();
})();
