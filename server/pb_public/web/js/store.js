/*
 * Всё состояние веб-версии: вход, ключи, люди, чаты, сообщения. Логика та же, что в Android (data/Repository.kt).
 * Закрытый ключ хранится в браузере в IndexedDB как неизвлекаемый ключ WebCrypto: им можно пользоваться,
 * но достать его байты из браузера нельзя.
 */
import * as C from "./crypto.js";
import { ApiError, api, get, post, patch, del, download, setToken, getToken, url, setSession, getSession, onTokenRenewed, renewToken } from "./api.js";

// ---------- События ----------
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, data) {
  (listeners.get(event) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
}

// ---------- Ключ в IndexedDB ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("beemes", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", mode);
    const req = fn(tx.objectStore("keys"));
    tx.oncomplete = () => { db.close(); resolve(req && req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const saveKey = (key) => idbDo("readwrite", (s) => s.put(key, "private"));
const loadKey = () => idbDo("readonly", (s) => s.get("private")).catch(() => null);
const saveRaw = (raw) => idbDo("readwrite", (s) => s.put(raw, "private_raw"));
const loadRaw = () => idbDo("readonly", (s) => s.get("private_raw")).catch(() => null);
const clearKeys = () => idbDo("readwrite", (s) => s.clear()).catch(() => {});

/**
 * Safari и всё на iPhone/iPad (там любой браузер — Safari внутри) сохраняет неизвлекаемый ключ WebCrypto,
 * но после перезапуска приложения с экрана «Домой» прочитать его уже не может. Там храним сам ключ (32 байта)
 * в хранилище сайта — так же делают другие веб-мессенджеры. В остальных браузерах ключ неизвлекаемый.
 */
function keepRawKey() {
  try { if (localStorage.getItem("bm_key_raw") === "1") return true; } catch (_) { /* ignore */ }
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|Android/.test(ua);
  return ios || safari;
}

/** Сохранить ключ на этом устройстве. */
async function storeKey(raw) {
  const key = await C.importPrivate(raw, false);
  try { await saveKey(key); } catch (_) { /* Safari бывает не умеет — ниже запасной способ */ }
  if (keepRawKey()) await saveRaw(new Uint8Array(raw));
  return key;
}

/** Ключ с этого устройства: неизвлекаемый, иначе из сохранённых байтов. */
async function storedKey() {
  const key = await loadKey();
  if (key) {
    // проверяем, что ключ действительно работает (Safari может вернуть «пустой»)
    try { await C.chatKeyBytes(key, C.unb64("WGmv9FBUlzLLqu1eXfmzCm2jHLDldCutWtShp2jxpns="), "check"); return key; } catch (_) { /* ниже */ }
  }
  const raw = await loadRaw();
  if (raw && raw.length === 32) {
    try { return await C.importPrivate(new Uint8Array(raw), false); } catch (_) { /* ниже */ }
  }
  return null;
}

// ---------- Состояние ----------
export const state = {
  me: null,
  privateKey: null,
  users: new Map(),
  chats: [], // { chat, peer, last, unread, muted, hidden, peerReadAt }
  loaded: false,
  openChatId: null,
};
const chatCache = new Map();
const keyCache = new Map();
const myStates = new Map();
const peerRead = new Map();
const messages = new Map(); // chatId → [msg]
const photoUrls = new Map();

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* приватный режим */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};

export const theme = {
  get: () => ls.get("bm_theme") || "system",
  set: (v) => { ls.set("bm_theme", v); emit("theme", v); },
};
export const notifyOn = {
  get: () => ls.get("bm_notify") !== "0",
  set: (v) => ls.set("bm_notify", v ? "1" : "0"),
};
export const soundOn = {
  get: () => ls.get("bm_sound") !== "0",
  set: (v) => ls.set("bm_sound", v ? "1" : "0"),
};

export const parseTime = (v) => (v ? new Date(String(v).replace(" ", "T")) : null);
export const serverTime = (d) => d.toISOString().replace("T", " ");

function remember(u) {
  if (!u || !u.id) return u;
  state.users.set(u.id, { ...(state.users.get(u.id) || {}), ...u });
  emit("users");
  return state.users.get(u.id);
}
/** В приложении для Windows — сразу записать на диск. */
const flushDesktop = () => { try { if (window.beemesDesktop && window.beemesDesktop.flush) window.beemesDesktop.flush(); } catch (_) { /* ignore */ } };

/** Сеанс этого устройства (id и секрет) — им приложение само продлевает вход. */
function keepDeviceSession(sess) {
  if (!sess || !sess.id || !sess.secret) return;
  setSession(sess);
  ls.set("bm_session", JSON.stringify(sess));
}
// Вход продлили секретом сеанса — запоминаем новый пропуск.
onTokenRenewed((r) => {
  ls.set("bm_token", r.token);
  if (r.record && state.me && r.record.id === state.me.id) {
    state.me = { ...state.me, ...r.record };
    ls.set("bm_me", JSON.stringify(state.me));
  }
  flushDesktop();
});

function saveSession(token, me) {
  setToken(token);
  state.me = me;
  remember(me);
  ls.set("bm_token", token);
  ls.set("bm_me", JSON.stringify(me));
  emit("me", me);
  flushDesktop();
}

// ---------- Вход ----------

/** При открытии страницы: вход сохранён? */
/**
 * При открытии страницы: вход сохранён?
 * → true (вошли), false (нужно войти) или "locked" (вход есть, но ключа на устройстве нет — нужен только пароль).
 */
export async function restore() {
  const token = ls.get("bm_token");
  const meRaw = ls.get("bm_me");
  if (!token || !meRaw) return false;
  try { setSession(JSON.parse(ls.get("bm_session") || "null")); } catch (_) { /* без сеанса */ }
  try {
    state.me = JSON.parse(meRaw);
  } catch (_) {
    return false;
  }
  setToken(token);
  const key = await storedKey();
  if (!key) { remember(state.me); return "locked"; }
  state.privateKey = key;
  remember(state.me);
  try {
    const r = await post("api/collections/users/auth-refresh");
    saveSession(r.token, r.record);
    // вошли до появления сеансов — заводим сеанс этого устройства
    if (!getSession()) keepDeviceSession(await post("api/bm/session/create").catch(() => null));
  } catch (e) {
    if (e.status === 401 || e.status === 404) { await logout(); return false; }
    // нет сети — работаем с сохранённым
  }
  return true;
}

export const usernameFree = (name) => get(`api/bm/username/${encodeURIComponent(name.trim().toLowerCase().replace(/^@/, ""))}`);

export async function register(name, username, password) {
  const login = username.trim().toLowerCase().replace(/^@/, "");
  const id = await C.newIdentity();
  const { wrapped, salt } = await C.wrapPrivateKey(id.privateKey, password);
  const auth = await C.authPassword(login, password);
  await post("api/collections/users/records", {
    name: name.trim(), username: login, password: auth, passwordConfirm: auth,
    publicKey: C.b64(id.publicKey), wrappedKey: wrapped, wrapSalt: salt,
  });
  await login_(login, password);
}

async function login_(username, password, code = "") {
  const login = username.trim().toLowerCase().replace(/^@/, "");
  let auth;
  try {
    auth = await api("POST", "api/collections/users/auth-with-password", {
      body: { identity: login, password: await C.authPassword(login, password), ...(code ? { code: code.trim() } : {}) },
    });
  } catch (e) {
    // 2FA: пароль верный, нужен код из письма
    if (e.raw && e.raw.twoFactor) { const err = new ApiError("Введите код из письма"); err.twoFactor = String(e.raw.twoFactor.message || "вашу почту").replace(/\.$/, "").toLowerCase(); throw err; }
    throw e;
  }
  setToken(auth.token);
  let raw;
  try {
    const keys = await get("api/bm/keys");
    raw = await C.unwrapPrivateKey(keys.encKey, keys.keySalt, password);
    if (C.b64(await C.publicFromPrivate(raw)) !== keys.publicKey) throw new Error("mismatch");
  } catch (e) {
    setToken("");
    throw e instanceof ApiError ? e : new ApiError("Не получилось расшифровать ключ. Проверьте пароль.");
  }
  state.privateKey = await storeKey(raw);
  raw.fill(0);
  keepDeviceSession(auth.meta && auth.meta.session);
  saveSession(auth.token, auth.record);
}
export { login_ as login };

/** Вход есть, а ключа на устройстве нет: открываем переписку паролем (копия ключа на сервере закрыта им). */
export async function unlock(password) {
  const me = state.me;
  const keys = await get("api/bm/keys");
  let raw;
  try {
    raw = await C.unwrapPrivateKey(keys.encKey, keys.keySalt, password);
    if (C.b64(await C.publicFromPrivate(raw)) !== keys.publicKey) throw new Error("mismatch");
  } catch (_) {
    throw new ApiError("Неверный пароль");
  }
  state.privateKey = await storeKey(raw);
  raw.fill(0);
  saveSession(getToken(), me);
}

export async function logout() {
  await presence("offline");
  await disablePush().catch(() => {});
  // закрыть сеанс этого устройства (остальные устройства не трогаем)
  const sess = getSession();
  if (sess) await post(`api/bm/sessions/${sess.id}/end`).catch(() => {});
  setSession(null);
  ls.del("bm_session");
  setToken("");
  ls.del("bm_token");
  ls.del("bm_me");
  await clearKeys();
  state.me = null;
  state.privateKey = null;
  state.users.clear();
  state.chats = [];
  adminCached = null;
  state.loaded = false;
  [chatCache, keyCache, myStates, peerRead, messages].forEach((m) => m.clear());
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls.clear();
  wallpaperUrls.forEach((u) => URL.revokeObjectURL(u));
  wallpaperUrls.clear();
  groupRaw.clear(); groupKeys.clear(); keysLoaded = new Map();
  emit("me", null);
  flushDesktop();
}

// ---------- Люди и профиль ----------

export async function user(id, fresh = false) {
  if (!fresh && state.users.get(id) && state.users.get(id).publicKey) return state.users.get(id);
  return remember(await get(`api/collections/users/records/${id}`));
}

export async function search(query) {
  const q = query.trim().replace(/^@/, "").replace(/['\\]/g, "");
  if (q.length < 2) return [];
  const r = await get("api/collections/users/records", {
    filter: `(username ~ '${q}' || name ~ '${q}') && id != '${state.me.id}'`, perPage: 30, sort: "username",
  });
  return r.items.map(remember);
}

export async function updateProfile(fields) {
  const updated = await patch(`api/collections/users/records/${state.me.id}`, fields);
  saveSession(getToken(), updated);
}

export async function setAvatar(blob) {
  let updated;
  if (!blob) updated = await patch(`api/collections/users/records/${state.me.id}`, { avatar: "" });
  else {
    const form = new FormData();
    form.append("avatar", blob, "avatar.jpg");
    updated = await api("PATCH", `api/collections/users/records/${state.me.id}`, { body: form });
  }
  saveSession(getToken(), updated);
}

/** Смена пароля: копия закрытого ключа на сервере перешифровывается новым паролем. */
export async function changePassword(oldPw, newPw) {
  const me = state.me;
  const keys = await get("api/bm/keys");
  let raw;
  try {
    raw = await C.unwrapPrivateKey(keys.encKey, keys.keySalt, oldPw);
  } catch (_) {
    throw new ApiError("Неверный текущий пароль");
  }
  const { wrapped, salt } = await C.wrapPrivateKey(raw, newPw);
  raw.fill(0);
  const auth = await C.authPassword(me.username, newPw);
  await patch(`api/collections/users/records/${me.id}`, {
    oldPassword: await C.authPassword(me.username, oldPw), password: auth, passwordConfirm: auth, wrappedKey: wrapped, wrapSalt: salt,
  });
  // Смена пароля обнуляет пропуска; этот сеанс продлевается секретом (без кода из письма), другие сеансы сервер закрыл.
  if (!(getSession() && await renewToken())) await login_(me.username, newPw);
}

export async function deleteAccount() {
  await del(`api/collections/users/records/${state.me.id}`);
  await logout();
}

/** Пробное уведомление на мои телефоны → отчёт сервера. */
export const pushTest = () => post("api/bm/push-test");

// ---------- Устройства, вход по QR-коду, почта и 2FA ----------

export const sessions = () => get("api/bm/sessions").then((r) => r.items);
export const endSession = (id) => post(`api/bm/sessions/${id}/end`);
export const endOtherSessions = () => post("api/bm/sessions/end-others");

/** Новое устройство: QR для входа. → { id, link, poll(): «ждём» / вошли }. */
export async function qrLoginStart() {
  const eph = await C.newIdentity();
  const r = await post("api/bm/qr/start", { pub: C.b64(eph.publicKey) });
  const link = `${location.origin}/web/#/qr/${r.id}/${C.b64url(eph.publicKey)}`;
  async function poll() {
    const res = await post(`api/bm/qr/${r.id}/poll`, { secret: r.secret });
    if (!res.token) return res.status; // "pending" | "declined"
    const q = res.meta && res.meta.qr;
    const raw = await C.qrOpen(eph.privateKey, q.e2pub, r.id, q.body, q.nonce);
    if (C.b64(await C.publicFromPrivate(raw)) !== res.record.publicKey) throw new ApiError("Ключ не подошёл — попробуйте ещё раз");
    setToken(res.token);
    state.privateKey = await storeKey(raw);
    raw.fill(0);
    keepDeviceSession(res.meta.session);
    saveSession(res.token, res.record);
    return "done";
  }
  return { id: r.id, link, expiresIn: r.expiresIn, poll };
}

export const qrInfo = (id) => get(`api/bm/qr/${id}`);
export const qrDecline = (id) => post(`api/bm/qr/${id}/decline`);
/** Подтвердить вход на новом устройстве: передаём ключ переписки зашифрованным для ключа из QR. */
export async function qrApprove(id, pubB64url) {
  const raw = await loadRaw();
  if (!raw || raw.length !== 32) throw new ApiError("В этом браузере ключ переписки защищён и передать его нельзя. Подтвердите вход в приложении beemes на телефоне.");
  const sealed = await C.qrSeal(C.unb64url(pubB64url), id, new Uint8Array(raw));
  await post(`api/bm/qr/${id}/approve`, sealed);
}
export const canApproveQr = async () => { const r = await loadRaw(); return !!(r && r.length === 32); };

export const emailStart = (email) => post("api/bm/email/start", { email });
export async function emailConfirm(code) {
  const r = await post("api/bm/email/confirm", { code });
  saveSession(r.token, r.record);
  return r.meta && r.meta.email;
}
export async function emailRemove(password) {
  const r = await post("api/bm/email/remove", { password: await C.authPassword(state.me.username, password) });
  saveSession(r.token, r.record);
}
export async function setTwoFactor(enabled, password) {
  await post("api/bm/2fa", { enabled, password: await C.authPassword(state.me.username, password) });
  const r = await post("api/collections/users/auth-refresh");
  saveSession(r.token, r.record);
}

// ---------- Уведомления, когда beemes закрыт (Web Push: браузер и iPhone) ----------

/** iPhone или iPad (там любой браузер — Safari внутри). */
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** Открыт с экрана «Домой» как приложение. */
export const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
/** Браузер умеет уведомления при закрытой странице (в приложении для Windows они приходят и так). */
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !window.beemesDesktop;

const keyBytes = (b64u) => C.unb64(b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4));

/** Подписать этот браузер на уведомления (уведомления уже разрешены). Повторный вызов просто обновляет запись. */
export async function enablePush() {
  if (!pushSupported() || Notification.permission !== "granted" || !state.me) return false;
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await get("api/bm/webpush-key");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  await idbDo("readwrite", (st) => st.put(sub.endpoint, "push_endpoint")).catch(() => {});
  await idbDo("readwrite", (st) => st.put(state.me.id, "user_id")).catch(() => {});
  await post("api/collections/devices/records", { user: state.me.id, token: sub.endpoint, platform: "web", appVersion: "web", presence: deviceId() });
  return true;
}

/** Выход: этот браузер больше не получает уведомления этого аккаунта. */
export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("sw.js").catch(() => null);
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  try {
    const found = await get("api/collections/devices/records", { filter: `token = "${sub.endpoint.replace(/"/g, "")}"`, perPage: 5 });
    for (const d of found.items || []) await del("api/collections/devices/records/" + d.id).catch(() => {});
  } catch (_) { /* не страшно: сервер сам забудет подписку, когда служба уведомлений её отклонит */ }
  await sub.unsubscribe().catch(() => {});
}

// ---------- «В сети» ----------
function deviceId() {
  let id = ls.get("bm_device");
  if (!id) { id = "w" + Math.random().toString(36).slice(2, 12); ls.set("bm_device", id); }
  return id;
}
let presenceSeq = 0;
/**
 * Сообщить серверу: beemes открыт (online) или свёрнут/закрыт (offline).
 * closing — страница закрывается: шлём маячком (sendBeacon), его браузер доставит даже после закрытия.
 */
export function presence(state, closing = false) {
  if (!state || !getToken()) return Promise.resolve();
  presenceSeq = Math.max(presenceSeq + 1, Date.now());
  const body = { state, device: deviceId(), seq: presenceSeq, session: (getSession() || {}).id || "" };
  if (closing && navigator.sendBeacon) {
    try {
      const sent = navigator.sendBeacon(url("api/bm/presence"), new Blob([JSON.stringify({ ...body, token: getToken() })], { type: "application/json" }));
      if (sent) return Promise.resolve();
    } catch (_) { /* ниже обычным запросом */ }
  }
  return api("POST", "api/bm/presence", { body, keepalive: closing }).catch(() => {});
}
/** Обновление записи человека пришло в реальном времени (например, вошёл или вышел из сети). */
export function applyUser(u) {
  if (!u || !u.id) return;
  remember(u);
  state.chats = state.chats.map((i) => (i.peer.id === u.id ? { ...i, peer: { ...i.peer, ...u } } : i));
}
/** id собеседников — за их «в сети» следим в реальном времени. */
export const peerIds = () => [...new Set(state.chats.map((i) => i.peer.id))].slice(0, 300);


// ---------- Чаты ----------

export const peerOf = (chat) => (chat.members || []).find((m) => m !== (state.me && state.me.id)) || "";

// ---------- Ключи групп и каналов ----------
export const isGroup = (c) => !!(c && c.type);
const groupRaw = new Map(); // "чат:эпоха" → 32 байта ключа
const groupKeys = new Map(); // "чат:эпоха" → ключ AES
let keysLoaded = new Map(); // чат → Promise загрузки своих экземпляров ключей
const keysTried = new Map();

/** Загрузить свои экземпляры ключей группы с сервера и расшифровать. */
function loadGroupKeys(chatId, force = false) {
  if (!force && keysLoaded.has(chatId)) return keysLoaded.get(chatId);
  const p = (async () => {
    const rows = (await get("api/collections/chat_keys/records", { filter: `chat = '${chatId}'`, perPage: 200 })).items;
    for (const r of rows) {
      const id = `${chatId}:${r.epoch}`;
      if (groupRaw.has(id)) continue;
      try {
        const from = r.from === state.me.id ? state.me : await user(r.from);
        const raw = await C.unwrapGroupKey(state.privateKey, C.unb64(from.publicKey), chatId, r.epoch, state.me.id, r.body, r.nonce);
        groupRaw.set(id, raw);
      } catch (_) { /* испорченный экземпляр — пропускаем */ }
    }
  })().catch(() => { keysLoaded.delete(chatId); });
  keysLoaded.set(chatId, p);
  return p;
}

/** Ключ сообщений группы для эпохи (публичный канал — открытый ключ, эпоха 0). null — ключа у нас нет. */
async function groupKeyFor(c, epoch) {
  const id = `${c.id}:${epoch}`;
  if (groupKeys.has(id)) return groupKeys.get(id);
  let raw = null;
  if (c.isPublic && c.openKey) raw = C.unb64(c.openKey);
  else {
    if (!groupRaw.has(id)) {
      // ключа этой эпохи нет — перечитаем свои экземпляры (не чаще раза в 10 секунд)
      const stale = keysLoaded.has(c.id) && Date.now() - (keysTried.get(c.id) || 0) > 10000;
      if (stale) keysTried.set(c.id, Date.now());
      await loadGroupKeys(c.id, stale);
    }
    raw = groupRaw.get(id) || null;
  }
  if (!raw) return null;
  if (!c.isPublic) groupRaw.set(id, raw);
  const k = C.groupKey(raw);
  groupKeys.set(id, k);
  return k;
}

/** Отдать ключ эпохи участникам (их открытые ключи — в users). */
async function shareGroupKey(chatId, epoch, raw, users) {
  for (const u of users) {
    if (!u || !u.publicKey) continue;
    const w = await C.wrapGroupKey(state.privateKey, C.unb64(u.publicKey), chatId, epoch, u.id, raw);
    await post("api/collections/chat_keys/records", { chat: chatId, user: u.id, epoch, from: state.me.id, body: w.body, nonce: w.nonce }).catch(() => {});
  }
}

async function keyFor(chat, peer) {
  if (keyCache.has(chat.id)) return keyCache.get(chat.id);
  if (!state.privateKey || !peer || !peer.publicKey) return null;
  const p = C.chatKey(state.privateKey, C.unb64(peer.publicKey), chat.id);
  keyCache.set(chat.id, p);
  return p;
}

export async function decrypt(r, chat = chatCache.get(r.chat)) {
  let content = null;
  try {
    let key;
    if (isGroup(chat)) key = await groupKeyFor(chat, r.epoch || 0);
    else {
      const peer = chat && (state.users.get(peerOf(chat)) || (await user(peerOf(chat))));
      key = await keyFor(chat, peer);
    }
    content = await C.open(key, r.body, r.nonce, C.messageAad(r.chat, r.sender));
  } catch (_) { /* не расшифровать — покажем «не удалось» */ }
  return {
    id: r.id, chatId: r.chat, senderId: r.sender, kind: r.kind, content, epoch: r.epoch || 0,
    created: parseTime(r.created) || new Date(), edited: !!r.editedAt, file: r.file || "", replyTo: r.replyTo || "",
    status: statusFor(r.chat, r.sender, parseTime(r.created)),
  };
}

function statusFor(chatId, sender, created) {
  if (!state.me || sender !== state.me.id) return "sent";
  const read = peerRead.get(chatId);
  return read && created && created <= read ? "read" : "sent";
}

async function item(c, unread) {
  if (isGroup(c)) {
    const st = myStates.get(c.id);
    const lastRec = c.expand && c.expand.lastMessage;
    const local = messages.get(c.id);
    const last = lastRec ? await decrypt(lastRec, c) : local && local.length ? local[local.length - 1] : null;
    if (last && last.senderId !== state.me.id && !state.users.get(last.senderId)) await user(last.senderId).catch(() => null);
    return { chat: c, peer: null, group: true, last, unread, muted: !!(st && st.muted), hidden: !!(st && st.hidden) && !last, peerReadAt: peerRead.get(c.id) || null };
  }
  const peerId = peerOf(c);
  if (!peerId) return null;
  const peer = state.users.get(peerId) || ((c.expand && c.expand.members) || []).find((u) => u.id === peerId);
  if (!peer) return null;
  const st = myStates.get(c.id);
  const lastRec = c.expand && c.expand.lastMessage;
  const local = messages.get(c.id);
  const last = lastRec ? await decrypt(lastRec, c) : local && local.length ? local[local.length - 1] : null;
  return { chat: c, peer, last, unread, muted: !!(st && st.muted), hidden: !!(st && st.hidden) && !last, peerReadAt: peerRead.get(c.id) || null };
}

export async function refreshChats() {
  if (!state.me) return;
  const [list, unread, states] = await Promise.all([
    get("api/collections/chats/records", { expand: "members,lastMessage", sort: "-lastMessageAt,-created", perPage: 200 }),
    get("api/bm/unread").then((r) => r.unread || {}).catch(() => ({})),
    get("api/collections/chat_state/records", { perPage: 500 }).then((r) => r.items).catch(() => []),
  ]);
  for (const s of states) {
    if (s.user === state.me.id) myStates.set(s.chat, s);
    else if (s.readAt) {
      const t = parseTime(s.readAt);
      const prev = peerRead.get(s.chat);
      if (!prev || t > prev) peerRead.set(s.chat, t);
    }
  }
  for (const c of list.items) {
    chatCache.set(c.id, c);
    ((c.expand && c.expand.members) || []).forEach(remember);
  }
  state.chats = (await Promise.all(list.items.map((c) => item(c, unread[c.id] || 0)))).filter(Boolean);
  state.loaded = true;
  emit("chats");
}

export async function chat(id) {
  if (chatCache.has(id)) return chatCache.get(id);
  const c = await get(`api/collections/chats/records/${id}`, { expand: "members" });
  ((c.expand && c.expand.members) || []).forEach(remember);
  chatCache.set(id, c);
  return c;
}

// ---------- Группы и каналы ----------

/** Создать группу или канал. Ключ создаём здесь и раздаём участникам (сервер его не видит). */
export async function createGroup({ type, title, about = "", members = [], isPublic = false, handle = "" }) {
  const raw = C.newGroupKey();
  const body = { type, title, about, members, isPublic, handle };
  if (isPublic) body.openKey = C.b64(raw);
  const c = await post("api/bm/groups", body);
  chatCache.set(c.id, c);
  if (!isPublic) {
    groupRaw.set(`${c.id}:1`, raw);
    keysLoaded.set(c.id, Promise.resolve());
    const people = [state.me, ...(await Promise.all(c.members.filter((m) => m !== state.me.id).map((m) => user(m).catch(() => null))))];
    await shareGroupKey(c.id, 1, raw, people);
  }
  await refreshChats();
  return c;
}

/** Ссылка-приглашение: код для сервера + ключ после «#» (на сервер не уходит). */
export function inviteLink(c) {
  if (c.isPublic) return `${location.origin}/web/#/c/${c.handle}`;
  const raw = groupRaw.get(`${c.id}:${c.keyEpoch}`);
  if (!c.inviteCode || !raw) return "";
  return `${location.origin}/web/#/join/${c.inviteCode}/${c.keyEpoch}.${C.b64url(raw)}`;
}
export async function ensureGroupKey(c) { if (!c.isPublic) await groupKeyFor(c, c.keyEpoch); }

export const invitePreview = (code) => get(`api/bm/invite/${encodeURIComponent(code)}`);

/** Вступить по ссылке: сервер добавляет в участники, ключ из ссылки сохраняем для своих устройств. */
export async function joinByInvite(code, epoch, key) {
  const c = await post("api/bm/join", { code });
  chatCache.set(c.id, c);
  if (key && epoch) {
    const raw = C.unb64url(key);
    if (raw.length === 32) {
      groupRaw.set(`${c.id}:${epoch}`, raw);
      await shareGroupKey(c.id, Number(epoch), raw, [state.me]);
    }
  }
  keysLoaded.delete(c.id);
  await refreshChats();
  return c;
}

/** Подписаться на публичный канал. */
export async function joinPublic(chatId) {
  const c = await post("api/bm/join", { chat: chatId });
  chatCache.set(c.id, c);
  await refreshChats();
  return c;
}

export const channelByHandle = (handle) => get("api/bm/channels", { handle }).then((r) => r.items[0] || null);
export const searchChannels = (q) => get("api/bm/channels", { q }).then((r) => r.items).catch(() => []);

// ---------- Админ-панель (только у админа: users.admin ставится в панели PocketBase) ----------
let adminCached = null;
/** Я админ? (запоминаем до выхода) */
export async function isAdmin() {
  if (adminCached === null) adminCached = await get("api/bm/admin/me").then((r) => !!r.admin).catch(() => false);
  return adminCached;
}
/** kind: "users" | "chats"; пустой запрос — все с галочкой. */
export const adminSearch = (kind, q) => get("api/bm/admin/search", { kind, q }).then((r) => r.items);
export async function adminBadge(kind, id, badge) {
  const r = await post("api/bm/admin/badge", { kind, id, badge });
  if (kind === "user") { const u = state.users.get(id); if (u) remember({ ...u, badge: r.badge }); }
  else await refreshChats().catch(() => {});
  return r;
}
export const groupMembers = (id) => get(`api/bm/groups/${id}/members`);

/** Свежие данные группы (после изменений). */
export async function reloadChat(id) {
  const c = await get(`api/collections/chats/records/${id}`, { expand: "lastMessage" });
  chatCache.set(id, c);
  return c;
}

export async function leaveGroup(id) {
  await post(`api/bm/groups/${id}/leave`);
  chatCache.delete(id);
  messages.delete(id);
  state.chats = state.chats.filter((i) => i.chat.id !== id);
  emit("chats");
}
export async function deleteGroup(id) {
  await post(`api/bm/groups/${id}/delete`);
  chatCache.delete(id);
  state.chats = state.chats.filter((i) => i.chat.id !== id);
  emit("chats");
}
export const setAdmin = (id, userId, admin) => post(`api/bm/groups/${id}/admin`, { user: userId, admin });
export const newInvite = (id) => post(`api/bm/groups/${id}/invite`).then(() => reloadChat(id));
export async function updateGroup(id, fields) {
  const c = await patch(`api/collections/chats/records/${id}`, fields);
  chatCache.set(id, c);
  await refreshChats();
  return c;
}
export async function setGroupPhoto(id, blob) {
  const form = new FormData();
  if (blob) form.append("photo", blob, "photo.jpg"); else form.append("photo", "");
  const c = await api("PATCH", `api/collections/chats/records/${id}`, { body: form });
  chatCache.set(id, c);
  await refreshChats();
  return c;
}

/** Добавить людей: сервер записывает их в участники, а ключ им отдаём мы. */
export async function addMembers(id, userIds) {
  const r = await post(`api/bm/groups/${id}/add`, { users: userIds });
  const c = await reloadChat(id);
  if (!c.isPublic && r.added.length) {
    await groupKeyFor(c, c.keyEpoch);
    const raw = groupRaw.get(`${id}:${c.keyEpoch}`);
    if (raw) await shareGroupKey(id, c.keyEpoch, raw, await Promise.all(r.added.map((u) => user(u).catch(() => null))));
  }
  return r.added;
}

/** Исключить: сервер меняет эпоху, мы создаём новый ключ и раздаём его оставшимся. */
export async function removeMember(id, userId) {
  const r = await post(`api/bm/groups/${id}/remove`, { user: userId });
  const c = await reloadChat(id);
  if (!c.isPublic) {
    const raw = C.newGroupKey();
    groupRaw.set(`${id}:${r.epoch}`, raw);
    const { members } = await groupMembers(id);
    await shareGroupKey(id, r.epoch, raw, members);
  }
  return c;
}

/** У кого нет ключа текущей эпохи (вступили, пока нас не было) — отдаём, если он есть у нас. */
export async function healGroupKeys(c) {
  if (!isGroup(c) || c.isPublic || !c.joined) return;
  if (c.type === "channel" && !isAdminOf(c)) return;
  await groupKeyFor(c, c.keyEpoch);
  const raw = groupRaw.get(`${c.id}:${c.keyEpoch}`);
  if (!raw) return;
  const { members } = await groupMembers(c.id);
  const missing = members.filter((m) => !m.hasKey);
  if (missing.length) await shareGroupKey(c.id, c.keyEpoch, raw, missing);
}
export const isAdminOf = (c) => !!(c && state.me && (c.owner === state.me.id || (c.admins || []).includes(state.me.id)));

/** Чат с человеком (если его нет — создаётся). */
export async function chatWith(userId) {
  const c = await post("api/collections/chats/records", { members: [state.me.id, userId] });
  chatCache.set(c.id, c);
  await user(userId);
  if (!state.chats.some((i) => i.chat.id === c.id)) {
    const it = await item(c, 0);
    if (it) { state.chats = [it, ...state.chats]; emit("chats"); }
  }
  return c;
}

export const chatItem = (id) => state.chats.find((i) => i.chat.id === id) || null;

async function saveState(chatId, fields) {
  const existing = myStates.get(chatId);
  const saved = existing
    ? await patch(`api/collections/chat_state/records/${existing.id}`, fields)
    : await post("api/collections/chat_state/records", { chat: chatId, user: state.me.id, ...fields });
  myStates.set(chatId, saved);
}

// ---------- Фон чата (личный: собеседник его не видит) ----------
export const wallpaperOf = (chatId) => (myStates.get(chatId) || {}).wallpaper || "";
const wallpaperUrls = new Map();
const selfKey = (chatId) => C.chatKey(state.privateKey, C.unb64(state.me.publicKey), "wallpaper|" + chatId);
const wallpaperAad = (chatId) => new TextEncoder().encode(`wallpaper|${chatId}|${state.me.id}`);

/** Готовый фон ("p:<имя>") или обычный (""). */
export async function setWallpaper(chatId, value) {
  await saveState(chatId, { wallpaper: value, wallpaperFile: null });
  emit("wallpaper:" + chatId);
}

/** Своё фото: шифруем, ключ от фото шифруем своим ключом — сервер видит только шифр. */
export async function setWallpaperPhoto(chatId, prepared) {
  const { blob, key } = await C.encryptFile(prepared.jpeg);
  const sealed = await C.seal(await selfKey(chatId), { k: C.b64(key) }, wallpaperAad(chatId));
  if (!myStates.get(chatId)) await saveState(chatId, {});
  const form = new FormData();
  form.append("wallpaper", `photo:${sealed.nonce}.${sealed.body}`);
  form.append("wallpaperFile", new Blob([blob], { type: "application/octet-stream" }), "wallpaper.bin");
  const saved = await api("PATCH", `api/collections/chat_state/records/${myStates.get(chatId).id}`, { body: form });
  myStates.set(chatId, saved);
  wallpaperUrls.set(saved.wallpaper, URL.createObjectURL(new Blob([prepared.jpeg], { type: "image/jpeg" })));
  emit("wallpaper:" + chatId);
}

/** Своё фото этого чата → адрес картинки (или null). */
export async function wallpaperPhoto(chatId) {
  const st = myStates.get(chatId);
  if (!st || !String(st.wallpaper || "").startsWith("photo:") || !st.wallpaperFile) return null;
  if (wallpaperUrls.has(st.wallpaper)) return wallpaperUrls.get(st.wallpaper);
  const [nonce, body] = st.wallpaper.slice(6).split(".");
  const { k } = await C.open(await selfKey(chatId), body, nonce, wallpaperAad(chatId));
  const blob = await download(`api/files/chat_state/${st.id}/${st.wallpaperFile}`, { token: await token90() });
  const u = URL.createObjectURL(new Blob([await C.decryptFile(blob, C.unb64(k))], { type: "image/jpeg" }));
  wallpaperUrls.set(st.wallpaper, u);
  return u;
}

export async function setMuted(chatId, muted) {
  await saveState(chatId, { muted });
  state.chats = state.chats.map((i) => (i.chat.id === chatId ? { ...i, muted } : i));
  emit("chats");
}

export async function hideChat(chatId) {
  await saveState(chatId, { hidden: true });
  state.chats = state.chats.filter((i) => i.chat.id !== chatId);
  emit("chats");
}

export async function markRead(chatId) {
  const list = (messages.get(chatId) || []).filter((m) => m.status !== "sending" && m.status !== "failed");
  const last = list[list.length - 1];
  if (!last) return;
  const st = myStates.get(chatId);
  const current = st && parseTime(st.readAt);
  const hadUnread = (chatItem(chatId) || {}).unread > 0;
  if (current && last.created <= current && !hadUnread) return;
  state.chats = state.chats.map((i) => (i.chat.id === chatId ? { ...i, unread: 0 } : i));
  emit("chats");
  if (!current || last.created > current) await saveState(chatId, { readAt: serverTime(last.created) }).catch(() => {});
}

// ---------- Сообщения ----------

export const messagesOf = (chatId) => messages.get(chatId) || [];
const setMessages = (chatId, list) => { messages.set(chatId, list); emit("messages:" + chatId, list); };
const sortMsgs = (list) => list.sort((a, b) => {
  const pa = a.status === "sending" || a.status === "failed";
  const pb = b.status === "sending" || b.status === "failed";
  return pa !== pb ? (pa ? 1 : -1) : a.created - b.created;
});

/** Загрузить последние сообщения или более ранние (before). → есть ли ещё. */
export async function loadMessages(chatId, before = null) {
  const c = await chat(chatId);
  if (!isGroup(c)) await user(peerOf(c));
  let page;
  if (isGroup(c) && c.isPublic && c.joined === false) {
    // Публичный канал до подписки: посты отдаёт отдельный запрос.
    const r = await get(`api/bm/channels/${chatId}/posts`, before ? { before: serverTime(before) } : undefined);
    page = { items: r.items, totalPages: r.more ? 2 : 1 };
  } else {
    const filter = `chat = '${chatId}'` + (before ? ` && created < '${serverTime(before)}'` : "");
    page = await get("api/collections/messages/records", { filter, sort: "-created", perPage: 60 });
  }
  const loaded = await Promise.all(page.items.map((r) => decrypt(r, c)));
  const current = messagesOf(chatId);
  const pending = current.filter((m) => m.status === "sending" || m.status === "failed");
  const byId = new Map();
  if (before) current.filter((m) => !pending.includes(m)).forEach((m) => byId.set(m.id, m));
  loaded.forEach((m) => byId.set(m.id, m));
  setMessages(chatId, sortMsgs([...byId.values(), ...pending]));
  return page.totalPages > 1;
}

async function seal(chatId, content) {
  const c = await chat(chatId);
  if (isGroup(c)) {
    if (!c.isPublic) {
      // эпоха могла смениться (кого-то исключили) — берём свежую
      const fresh = await get(`api/collections/chats/records/${chatId}`).catch(() => null);
      if (fresh) { c.keyEpoch = fresh.keyEpoch; chatCache.set(chatId, { ...c, ...fresh }); }
    }
    const epoch = c.isPublic ? 0 : c.keyEpoch;
    const key = await groupKeyFor(c, epoch);
    if (!key) throw new ApiError("Ключ шифрования группы ещё не пришёл. Попросите админа открыть группу.");
    return { ...(await C.seal(key, content, C.messageAad(chatId, state.me.id))), epoch };
  }
  const peer = await user(peerOf(c));
  const key = await keyFor(c, peer);
  if (!key) throw new ApiError("Нет ключа шифрования собеседника");
  return C.seal(key, content, C.messageAad(chatId, state.me.id));
}

function onNewMessage(msg) {
  const existing = chatItem(msg.chatId);
  if (!existing) return;
  const unread = msg.senderId !== state.me.id && state.openChatId !== msg.chatId ? existing.unread + 1 : existing.unread;
  const updated = { ...existing, last: msg, unread, hidden: false };
  state.chats = [updated, ...state.chats.filter((i) => i.chat.id !== msg.chatId)];
  emit("chats");
}

async function send(chatId, kind, content, replyTo = "", file = null) {
  const localId = "local-" + Math.random().toString(36).slice(2);
  const pending = { id: localId, localId, chatId, senderId: state.me.id, kind, content, created: new Date(), edited: false, file: "", replyTo, status: "sending" };
  setMessages(chatId, sortMsgs([...messagesOf(chatId), pending]));
  try {
    const sealed = await seal(chatId, content);
    // Свой id: если связь оборвалась, повтор с тем же id не создаст дубль.
    // pushLater — уведомления попросим отдельным запросом, чтобы отправка не ждала Firebase.
    const fields = { id: newRecordId(), chat: chatId, sender: state.me.id, kind, body: sealed.body, nonce: sealed.nonce, pushLater: "1" };
    if (sealed.epoch !== undefined) fields.epoch = sealed.epoch;
    if (replyTo) fields.replyTo = replyTo;
    let saved = null;
    for (let attempt = 0; !saved; attempt++) {
      try {
        if (file) {
          const form = new FormData();
          Object.entries(fields).forEach(([k, v]) => form.append(k, v));
          form.append("file", new Blob([file], { type: "application/octet-stream" }), "photo.bin");
          saved = await api("POST", "api/collections/messages/records", { body: form });
        } else saved = await post("api/collections/messages/records", fields);
      } catch (e) {
        // прошлая попытка всё-таки дошла (ответ потерялся) — сообщение уже на сервере
        if (e.status === 400 && e.raw && e.raw.id) saved = await get(`api/collections/messages/records/${fields.id}`);
        // нет связи или сервер занят — пробуем ещё, тем же id
        else if ((!e.status || e.status === 429 || e.status >= 500) && attempt < 4) await new Promise((r) => setTimeout(r, [1500, 3000, 6000, 10000][attempt]));
        else throw e;
      }
    }
    post(`api/bm/messages/${fields.id}/notify`).catch(() => {});
    const msg = { ...pending, id: saved.id, created: parseTime(saved.created) || pending.created, file: saved.file || "", status: "sent", localId };
    const list = messagesOf(chatId);
    // realtime мог принести это сообщение раньше ответа сервера
    setMessages(chatId, sortMsgs(list.filter((m) => m.id !== saved.id).map((m) => (m.id === localId ? msg : m))));
    onNewMessage(msg);
    return msg;
  } catch (e) {
    setMessages(chatId, messagesOf(chatId).map((m) => (m.id === localId ? { ...m, status: "failed", error: e.message } : m)));
    throw e;
  }
}

/** id записи PocketBase: 15 символов a-z0-9. */
function newRecordId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => abc[b % 36]).join("");
}

export const sendText = (chatId, text, replyTo = "") => send(chatId, "text", { t: text.trim() }, replyTo);
/** Стикер из набора: st = "набор/имя", e — его эмодзи (для уведомлений и старых версий приложения). */
export const sendSticker = (chatId, st, e) => send(chatId, "sticker", { st, e, t: e });
export const sendCallLog = (chatId, video, seconds, status) => send(chatId, "call", { v: !!video, d: seconds | 0, s: status }).catch(() => {});

/** Фото: уменьшаем до 1600 px, превью 24 px, шифруем своим ключом. */
export async function sendPhoto(chatId, prepared, caption) {
  const { blob, key } = await C.encryptFile(prepared.jpeg);
  const content = { k: C.b64(key), w: prepared.width, h: prepared.height, p: prepared.preview };
  if (caption && caption.trim()) content.c = caption.trim();
  const localUrl = URL.createObjectURL(new Blob([prepared.jpeg], { type: "image/jpeg" }));
  photoUrls.set("local:" + content.k, localUrl);
  return send(chatId, "photo", content, "", blob);
}

export async function retry(msg) {
  setMessages(msg.chatId, messagesOf(msg.chatId).filter((m) => m.id !== msg.id));
  if (msg.kind === "text") return sendText(msg.chatId, msg.content.t, msg.replyTo);
}
export const discard = (msg) => setMessages(msg.chatId, messagesOf(msg.chatId).filter((m) => m.id !== msg.id));

export async function edit(msg, text) {
  const c = await chat(msg.chatId);
  if (isGroup(c) && (msg.epoch || 0) !== (c.isPublic ? 0 : c.keyEpoch)) throw new ApiError("Это сообщение уже не изменить: ключ группы сменился");
  const sealed = await seal(msg.chatId, { ...(msg.content || {}), t: text.trim() });
  const saved = await patch(`api/collections/messages/records/${msg.id}`, { body: sealed.body, nonce: sealed.nonce });
  await applyRecord(saved);
}

export async function remove(msg) {
  await del(`api/collections/messages/records/${msg.id}`);
  removeMessage(msg.chatId, msg.id);
}

// ---------- Фото ----------
let fileToken = null;
async function token90() {
  if (fileToken && Date.now() < fileToken.until) return fileToken.t;
  const t = (await post("api/files/token")).token;
  fileToken = { t, until: Date.now() + 90000 };
  return t;
}

export const cachedPhoto = (msg) => (msg.content && photoUrls.get("local:" + msg.content.k)) || photoUrls.get(msg.id) || null;

/** Скачать и расшифровать фото → адрес картинки для <img>. */
export async function photo(msg) {
  const cached = cachedPhoto(msg);
  if (cached) return cached;
  if (!msg.content || !msg.content.k || !msg.file) return null;
  const blob = await download(`api/files/messages/${msg.id}/${msg.file}`, { token: await token90() });
  const bytes = await C.decryptFile(blob, C.unb64(msg.content.k));
  const u = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  photoUrls.set(msg.id, u);
  return u;
}

// ---------- Блокировки ----------
export const blocked = () => get("api/collections/blocks/records", { perPage: 200, expand: "blocked" }).then((r) => r.items);
export const block = (userId) => post("api/collections/blocks/records", { user: state.me.id, blocked: userId });
export async function unblock(userId) {
  for (const b of await blocked()) if (b.blocked === userId) await del(`api/collections/blocks/records/${b.id}`);
}

// ---------- Звонки ----------
export const incoming = () => get("api/bm/incoming").then((r) => r.call).catch(() => null);
export async function declineCall(chatId, callId, from) {
  await post("api/collections/call_signals/records", { call: callId, from: state.me.id, to: from, chat: chatId, type: "decline", data: {} }).catch(() => {});
}
/** Адрес страницы звонка (вход передаётся в адресе и сразу оттуда убирается). */
export function callUrl(chatId, video, answerCall) {
  const p = new URLSearchParams({ chat: chatId });
  if (video) p.set("video", "1");
  if (answerCall) { p.set("call", answerCall); p.set("answer", "1"); }
  p.set("token", getToken());
  return `${location.origin}/call.html#${p.toString()}`;
}

// ---------- Обновления в реальном времени (realtime.js вызывает это) ----------

export async function applyRecord(r) {
  const c = chatCache.get(r.chat);
  const msg = await decrypt(r, c);
  const list = messagesOf(r.chat);
  if (list.some((m) => m.id === r.id)) {
    setMessages(r.chat, list.map((m) => (m.id === r.id ? { ...msg, status: m.status === "read" ? "read" : msg.status } : m)));
    return null;
  }
  setMessages(r.chat, sortMsgs([...list, msg]));
  if (!c || !chatItem(r.chat)) refreshChats().catch(() => {});
  else onNewMessage(msg);
  return msg;
}

export function removeMessage(chatId, id) {
  setMessages(chatId, messagesOf(chatId).filter((m) => m.id !== id));
  const it = chatItem(chatId);
  if (it && it.last && it.last.id === id) {
    const list = messagesOf(chatId);
    state.chats = state.chats.map((i) => (i.chat.id === chatId ? { ...i, last: list[list.length - 1] || null } : i));
    emit("chats");
  }
}

export function applyState(s) {
  if (!state.me) return;
  if (s.user === state.me.id) {
    const before = (myStates.get(s.chat) || {}).wallpaper || "";
    myStates.set(s.chat, s);
    // фон поменяли на другом устройстве
    if ((s.wallpaper || "") !== before) emit("wallpaper:" + s.chat);
    return;
  }
  let read = parseTime(s.readAt);
  if (!read) return;
  // В группе «прочитано», когда прочитал хоть кто-то.
  const prev = peerRead.get(s.chat);
  if (prev && prev > read) read = prev;
  peerRead.set(s.chat, read);
  setMessages(s.chat, messagesOf(s.chat).map((m) => (m.senderId === state.me.id && m.status === "sent" && m.created <= read ? { ...m, status: "read" } : m)));
  state.chats = state.chats.map((i) => (i.chat.id === s.chat ? { ...i, peerReadAt: read } : i));
  emit("chats");
}
