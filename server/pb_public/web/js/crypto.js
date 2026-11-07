/*
 * Шифрование beemes в браузере — то же самое, что в приложении для Android (data/Crypto.kt):
 * ключи X25519, ключ чата HKDF-SHA256, сообщения и фото AES-256-GCM, пароль — PBKDF2-SHA256.
 * Работает на WebCrypto (браузер и Node.js 20+).
 */
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const ITERATIONS = 210000;
const KEY_AAD = enc.encode("beemes-key-v1");
const CHAT_INFO = enc.encode("beemes-chat-v1");
const SAFETY = enc.encode("beemes-safety-v1");
// Начало ключа X25519 в формате PKCS#8 (дальше идут 32 байта самого ключа).
const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(text) {
  const s = atob(text);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function pbkdf2(password, salt) {
  const base = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, 256));
}

/** То, что уходит на сервер вместо пароля. */
export async function authPassword(username, password) {
  return b64(await pbkdf2(password, enc.encode("beemes-auth|" + username.toLowerCase())));
}

const aesKey = (raw, usages) => subtle.importKey("raw", raw, "AES-GCM", false, usages);
async function gcm(encrypt, key, nonce, data, aad) {
  const params = { name: "AES-GCM", iv: nonce, ...(aad ? { additionalData: aad } : {}) };
  return new Uint8Array(encrypt ? await subtle.encrypt(params, key, data) : await subtle.decrypt(params, key, data));
}

// ---------- Ключи X25519 ----------

/** Закрытый ключ (32 байта) → ключ WebCrypto для вычисления общего секрета. */
export function importPrivate(raw, extractable = false) {
  return subtle.importKey("pkcs8", concat(PKCS8_PREFIX, raw), { name: "X25519" }, extractable, ["deriveBits"]);
}

/** Открытый ключ по закрытому. */
export async function publicFromPrivate(raw) {
  const jwk = await subtle.exportKey("jwk", await importPrivate(raw, true));
  return unb64(jwk.x.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (jwk.x.length % 4)) % 4));
}

/** Новая пара ключей: { privateKey, publicKey } — по 32 байта. */
export async function newIdentity() {
  const pair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
  return { privateKey: pkcs8.slice(pkcs8.length - 32), publicKey: new Uint8Array(await subtle.exportKey("raw", pair.publicKey)) };
}

/** Закрытый ключ, зашифрованный паролем (копия на сервере для входа на новом устройстве). */
export async function wrapPrivateKey(raw, password) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await aesKey(await pbkdf2(password, salt), ["encrypt"]);
  return { wrapped: b64(concat(nonce, await gcm(true, key, nonce, raw, KEY_AAD))), salt: b64(salt) };
}

export async function unwrapPrivateKey(wrapped, salt, password) {
  const blob = unb64(wrapped);
  const key = await aesKey(await pbkdf2(password, unb64(salt)), ["decrypt"]);
  return gcm(false, key, blob.subarray(0, 12), blob.subarray(12), KEY_AAD);
}

// ---------- Ключ чата и сообщения ----------

/** Ключ чата (32 байта): одинаковый у обоих собеседников и свой для каждого чата. */
export async function chatKeyBytes(privateKey, theirPublic, chatId) {
  const priv = privateKey instanceof Uint8Array ? await importPrivate(privateKey) : privateKey;
  const pub = await subtle.importKey("raw", theirPublic, { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(chatId), info: CHAT_INFO }, hk, 256));
}

export async function chatKey(privateKey, theirPublic, chatId) {
  return aesKey(await chatKeyBytes(privateKey, theirPublic, chatId), ["encrypt", "decrypt"]);
}

export const messageAad = (chatId, senderId) => enc.encode(`${chatId}|${senderId}`);

// ---------- Группы и каналы ----------
// Ключ группы — 32 случайных байта (у каждой «эпохи» свой). Участнику он передаётся зашифрованным лично для него:
// X25519(от кого, кому) → HKDF(соль «group|чат|эпоха») → AES-GCM. Так же делают телефон (Crypto.kt) и тесты сервера.
const GROUP_INFO = enc.encode("beemes-group-key-v1");
async function groupWrapKey(privateKey, theirPublic, chatId, epoch) {
  const priv = privateKey instanceof Uint8Array ? await importPrivate(privateKey) : privateKey;
  const pub = await subtle.importKey("raw", theirPublic, { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const raw = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(`group|${chatId}|${epoch}`), info: GROUP_INFO }, hk, 256));
  return aesKey(raw, ["encrypt", "decrypt"]);
}
const groupAad = (chatId, epoch, userId) => enc.encode(`${chatId}|${epoch}|${userId}`);
export const newGroupKey = () => randomBytes(32);
/** Зашифровать ключ группы для участника userId (его открытый ключ theirPublic). */
export async function wrapGroupKey(privateKey, theirPublic, chatId, epoch, userId, raw) {
  const nonce = randomBytes(12);
  return { body: b64(await gcm(true, await groupWrapKey(privateKey, theirPublic, chatId, epoch), nonce, raw, groupAad(chatId, epoch, userId))), nonce: b64(nonce) };
}
/** Расшифровать свой экземпляр ключа группы (fromPublic — ключ того, кто его прислал). */
export async function unwrapGroupKey(privateKey, fromPublic, chatId, epoch, userId, body, nonce) {
  return gcm(false, await groupWrapKey(privateKey, fromPublic, chatId, epoch), unb64(nonce), unb64(body), groupAad(chatId, epoch, userId));
}
export const groupKey = (raw) => aesKey(raw, ["encrypt", "decrypt"]);
// ---------- Вход по QR-коду ----------
// Новое устройство показывает в QR свой временный открытый ключ. Телефон шифрует для него ключ переписки:
// X25519(временный ключ телефона, ключ из QR) → HKDF(соль «qr|id») → AES-GCM. Сервер только передаёт шифр.
const QR_INFO = enc.encode("beemes-qr-v1");
async function qrKey(privateKey, theirPublic, id) {
  const priv = privateKey instanceof Uint8Array ? await importPrivate(privateKey) : privateKey;
  const pub = await subtle.importKey("raw", theirPublic, { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  return aesKey(new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode("qr|" + id), info: QR_INFO }, hk, 256)), ["encrypt", "decrypt"]);
}
/** Телефон: зашифровать ключ переписки raw для устройства с ключом theirPublic. */
export async function qrSeal(theirPublic, id, raw) {
  const e2 = await newIdentity();
  const nonce = randomBytes(12);
  const body = await gcm(true, await qrKey(e2.privateKey, theirPublic, id), nonce, raw, enc.encode(id));
  return { e2pub: b64(e2.publicKey), body: b64(body), nonce: b64(nonce) };
}
/** Новое устройство: расшифровать ключ переписки своим временным ключом. */
export async function qrOpen(myPrivate, e2pub, id, body, nonce) {
  return gcm(false, await qrKey(myPrivate, unb64(e2pub), id), unb64(nonce), unb64(body), enc.encode(id));
}

export const b64url = (bytes) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64url = (text) => unb64(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));

/** Зашифровать содержимое сообщения (объект → JSON). */
export async function seal(key, content, aad) {
  const nonce = randomBytes(12);
  return { body: b64(await gcm(true, key, nonce, enc.encode(JSON.stringify(content)), aad)), nonce: b64(nonce) };
}

export async function open(key, body, nonce, aad) {
  return JSON.parse(dec.decode(await gcm(false, key, unb64(nonce), unb64(body), aad)));
}

// ---------- Фото ----------

/** Свой ключ для каждого фото: файл = nonce + шифр. */
export async function encryptFile(bytes) {
  const raw = randomBytes(32);
  const nonce = randomBytes(12);
  return { blob: concat(nonce, await gcm(true, await aesKey(raw, ["encrypt"]), nonce, bytes)), key: raw };
}

export async function decryptFile(blob, raw) {
  const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  return gcm(false, await aesKey(raw, ["decrypt"]), u.subarray(0, 12), u.subarray(12));
}

// ---------- Код безопасности ----------

/** 4 группы по 5 цифр — одинаковые у обоих собеседников. */
export async function safetyCode(a, b) {
  const [x, y] = b64(a) < b64(b) ? [a, b] : [b, a];
  const h = new Uint8Array(await subtle.digest("SHA-256", concat(SAFETY, x, y)));
  return [0, 1, 2, 3].map((i) => {
    const n = ((h[i * 4] << 24) >>> 0) + (h[i * 4 + 1] << 16) + (h[i * 4 + 2] << 8) + h[i * 4 + 3];
    return String(n % 100000).padStart(5, "0");
  });
}
