/*
 * Всё состояние веб-версии: вход, ключи, люди, чаты, сообщения. Логика та же, что в Android (data/Repository.kt).
 * Закрытый ключ хранится в браузере в IndexedDB как неизвлекаемый ключ WebCrypto: им можно пользоваться,
 * но достать его байты из браузера нельзя.
 */
import * as C from "./crypto.js";
import { ApiError, api, get, post, patch, del, download, setToken, getToken } from "./api.js";

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
const clearKeys = () => idbDo("readwrite", (s) => s.clear()).catch(() => {});

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

export const parseTime = (v) => (v ? new Date(String(v).replace(" ", "T")) : null);
export const serverTime = (d) => d.toISOString().replace("T", " ");

function remember(u) {
  if (!u || !u.id) return u;
  state.users.set(u.id, { ...(state.users.get(u.id) || {}), ...u });
  emit("users");
  return state.users.get(u.id);
}
function saveSession(token, me) {
  setToken(token);
  state.me = me;
  remember(me);
  ls.set("bm_token", token);
  ls.set("bm_me", JSON.stringify(me));
  emit("me", me);
}

// ---------- Вход ----------

/** При открытии страницы: вход сохранён? */
export async function restore() {
  const token = ls.get("bm_token");
  const meRaw = ls.get("bm_me");
  const key = await loadKey();
  if (!token || !meRaw || !key) return false;
  setToken(token);
  state.privateKey = key;
  try {
    state.me = JSON.parse(meRaw);
  } catch (_) {
    return false;
  }
  remember(state.me);
  try {
    const r = await post("api/collections/users/auth-refresh");
    saveSession(r.token, r.record);
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

async function login_(username, password) {
  const login = username.trim().toLowerCase().replace(/^@/, "");
  const auth = await api("POST", "api/collections/users/auth-with-password", {
    body: { identity: login, password: await C.authPassword(login, password) },
  });
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
  const key = await C.importPrivate(raw, false);
  raw.fill(0);
  await saveKey(key);
  state.privateKey = key;
  saveSession(auth.token, auth.record);
}
export { login_ as login };

export async function logout() {
  setToken("");
  ls.del("bm_token");
  ls.del("bm_me");
  await clearKeys();
  state.me = null;
  state.privateKey = null;
  state.users.clear();
  state.chats = [];
  state.loaded = false;
  [chatCache, keyCache, myStates, peerRead, messages].forEach((m) => m.clear());
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls.clear();
  emit("me", null);
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
  await login_(me.username, newPw);
}

export async function deleteAccount() {
  await del(`api/collections/users/records/${state.me.id}`);
  await logout();
}

export const ping = () => (state.me ? post("api/bm/online").catch(() => {}) : Promise.resolve());

// ---------- Чаты ----------

export const peerOf = (chat) => (chat.members || []).find((m) => m !== (state.me && state.me.id)) || "";

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
    const peer = chat && (state.users.get(peerOf(chat)) || (await user(peerOf(chat))));
    const key = await keyFor(chat, peer);
    content = await C.open(key, r.body, r.nonce, C.messageAad(r.chat, r.sender));
  } catch (_) { /* не расшифровать — покажем «не удалось» */ }
  return {
    id: r.id, chatId: r.chat, senderId: r.sender, kind: r.kind, content,
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
    else if (s.readAt) peerRead.set(s.chat, parseTime(s.readAt));
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
  await user(peerOf(c));
  const filter = `chat = '${chatId}'` + (before ? ` && created < '${serverTime(before)}'` : "");
  const page = await get("api/collections/messages/records", { filter, sort: "-created", perPage: 60 });
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
    const fields = { chat: chatId, sender: state.me.id, kind, body: sealed.body, nonce: sealed.nonce };
    if (replyTo) fields.replyTo = replyTo;
    let saved;
    if (file) {
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", new Blob([file], { type: "application/octet-stream" }), "photo.bin");
      saved = await api("POST", "api/collections/messages/records", { body: form });
    } else saved = await post("api/collections/messages/records", fields);
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

export const sendText = (chatId, text, replyTo = "") => send(chatId, "text", { t: text.trim() }, replyTo);
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
  if (s.user === state.me.id) { myStates.set(s.chat, s); return; }
  const read = parseTime(s.readAt);
  if (!read) return;
  peerRead.set(s.chat, read);
  setMessages(s.chat, messagesOf(s.chat).map((m) => (m.senderId === state.me.id && m.status === "sent" && m.created <= read ? { ...m, status: "read" } : m)));
  state.chats = state.chats.map((i) => (i.chat.id === s.chat ? { ...i, peerReadAt: read } : i));
  emit("chats");
}
