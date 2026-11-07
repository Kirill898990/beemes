/*
 * Помощник beemes в фоне (service worker): уведомления, когда beemes закрыт — в браузере и на iPhone
 * (сайт, добавленный на экран «Домой»).
 *
 * Сервер присылает пустой «толчок» без текста. Проснувшись, помощник забирает у сервера, что пришло,
 * и расшифровывает сообщение ключом с этого устройства — тем же способом, что и сама переписка
 * (js/crypto.js: X25519 → HKDF-SHA256 → AES-256-GCM). На каждый толчок обязательно показываем уведомление:
 * так требует iPhone.
 */
"use strict";

const ROOT = new URL("../", self.registration.scope).href;
const enc = new TextEncoder();
const dec = new TextDecoder();
const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---------- Ключ с этого устройства (его сохранила страница beemes) ----------
function idbGet(name) {
  return new Promise((resolve) => {
    let r;
    try { r = indexedDB.open("beemes", 1); } catch (_) { resolve(null); return; }
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      const db = r.result;
      try {
        const q = db.transaction("keys", "readonly").objectStore("keys").get(name);
        q.onsuccess = () => { db.close(); resolve(q.result == null ? null : q.result); };
        q.onerror = () => { db.close(); resolve(null); };
      } catch (_) { db.close(); resolve(null); }
    };
  });
}

function unb64(text) {
  const s = atob(text);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

async function chatKey(priv, theirPublic, chatId) {
  const pub = await crypto.subtle.importKey("raw", theirPublic, { name: "X25519" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const raw = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(chatId), info: enc.encode("beemes-chat-v1") }, hk, 256);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

/** Расшифровать сообщение из уведомления. → содержимое ({t: "текст"} и т. п.) или null. */
async function decrypt(d) {
  if (!d.body || !d.nonce || !d.senderKey) return null;
  const keys = [];
  const k = await idbGet("private");
  if (k) keys.push(k);
  const raw = await idbGet("private_raw");
  if (raw && raw.length === 32) {
    try {
      const pk = new Uint8Array(PKCS8_PREFIX.length + 32);
      pk.set(PKCS8_PREFIX); pk.set(new Uint8Array(raw), PKCS8_PREFIX.length);
      keys.push(await crypto.subtle.importKey("pkcs8", pk, { name: "X25519" }, false, ["deriveBits"]));
    } catch (_) { /* ниже — без текста */ }
  }
  for (const priv of keys) {
    try {
      const key = await chatKey(priv, unb64(d.senderKey), d.chat);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(d.nonce), additionalData: enc.encode(`${d.chat}|${d.sender}`) }, key, unb64(d.body));
      return JSON.parse(dec.decode(plain));
    } catch (_) { /* следующий способ */ }
  }
  return null;
}

/** Текст уведомления о сообщении — как в списке чатов. */
function messageText(kind, c) {
  if (!c) return "Новое сообщение";
  if (kind === "photo") return "📷 " + (c.c || "Фото");
  if (kind === "sticker") return (c.e ? c.e + " " : "") + "Стикер";
  if (kind === "call") return "Звонок";
  return String(c.t || "Новое сообщение").replace(/\s+/g, " ").slice(0, 300);
}

async function toNotification(d) {
  const icon = ROOT + "img/icon-192.png";
  if (d.type === "msg") {
    const content = await decrypt(d);
    return { title: d.senderName || "beemes", options: { body: messageText(d.kind, content), tag: "chat-" + d.chat, icon, silent: d.silent === "1", data: { chat: d.chat } } };
  }
  if (d.type === "call") {
    return { title: d.name || "beemes", options: { body: d.video ? "📹 Видеозвонок — нажмите, чтобы ответить" : "📞 Звонит — нажмите, чтобы ответить", tag: "call-" + d.call, icon, requireInteraction: true, data: { chat: d.chat, call: d.call } } };
  }
  if (d.type === "test") return { title: "beemes", options: { body: "Уведомления работают 🐝", tag: "test", icon, data: {} } };
  return null;
}

async function endpoint() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (sub) return sub.endpoint;
  } catch (_) { /* ниже */ }
  return idbGet("push_endpoint");
}

async function onPush() {
  let items = [];
  try {
    const ep = await endpoint();
    if (ep) {
      const r = await fetch(ROOT + "api/bm/push-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: ep }), cache: "no-store" });
      if (r.ok) items = (await r.json()).items || [];
    }
  } catch (_) { /* нет связи — покажем общее уведомление */ }
  const list = [];
  for (const d of items) {
    try { const n = await toNotification(d); if (n) list.push(n); } catch (_) { /* пропускаем */ }
  }
  if (!list.length) list.push({ title: "beemes", options: { body: "Новое сообщение", tag: "beemes", icon: ROOT + "img/icon-192.png", data: {} } });
  // Несколько сообщений из одного чата — одно уведомление с последним.
  const byTag = new Map();
  list.forEach((n) => byTag.set(n.options.tag, n));
  for (const n of byTag.values()) await self.registration.showNotification(n.title, n.options);
}

self.addEventListener("push", (event) => event.waitUntil(onPush()));

// Нажали на уведомление: открыть beemes на этом чате (если уже открыт — переключиться на него).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = new URL(d.chat ? "./#/chat/" + d.chat : "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try { await c.focus(); } catch (_) { /* ignore */ }
      c.postMessage({ type: "open", chat: d.chat || "" });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

