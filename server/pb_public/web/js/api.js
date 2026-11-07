/* Связь с сервером beemes (PocketBase): запросы, файлы, понятные ошибки. */

export class ApiError extends Error {
  constructor(message, status = 0, fields = {}, raw = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.raw = raw; // data из ответа сервера как есть (например, twoFactor)
  }
}

export const BASE = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:8091";

let token = "";
export const setToken = (t) => { token = t || ""; };
export const getToken = () => token;

function fieldMessage(field, code) {
  if (field === "username" && code === "validation_not_unique") return "Это @имя уже занято";
  if (field === "username") return "@имя: от 3 до 32 латинских букв, цифр или _";
  if (field === "password" && code === "validation_values_mismatch") return "Пароли не совпадают";
  if (field === "password") return "Пароль: не меньше 8 символов";
  if (field === "name") return "Впишите имя";
  if (field === "oldPassword") return "Неверный текущий пароль";
  return `Проверьте поле «${field}»`;
}

function parseError(status, text) {
  let message = "";
  const fields = {};
  let raw = {};
  try {
    const obj = JSON.parse(text);
    message = String(obj.message || "");
    raw = obj.data || {};
    for (const [field, v] of Object.entries(raw)) if (field !== "twoFactor") fields[field] = fieldMessage(field, v && v.code);
  } catch (_) { /* не JSON */ }
  const russian = /[а-яё]/i.test(message) ? message.replace(/\.$/, "") : "";
  const msg = Object.values(fields)[0] || russian ||
    (status === 400 && /authenticate/i.test(text) ? "Неверное @имя или пароль" :
      status === 401 ? "Нужно войти заново" :
        status === 403 ? "Нет доступа" :
          status === 404 ? "Не найдено" :
            status === 429 ? "Слишком много запросов. Подождите минуту." :
              status >= 500 ? "Ошибка на сервере. Попробуйте позже." : `Что-то пошло не так (код ${status})`);
  return new ApiError(msg, status, fields, raw);
}

export function url(path, query) {
  const u = new URL(path.replace(/^\//, ""), BASE + "/");
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  return u.toString();
}

// ---------- Сеанс устройства: продлевает вход, если пропуск устарел или сеансы перезапустили ----------
let session = null; // { id, secret }
let onRenewed = null;
export const setSession = (s) => { session = s && s.id && s.secret ? s : null; };
export const getSession = () => session;
export const onTokenRenewed = (fn) => { onRenewed = fn; };
/** Устройство и сеанс — в заголовках (название закодировано: в заголовках нельзя кириллицу). */
export function deviceHeaders() {
  const h = {};
  if (typeof window !== "undefined" && window.beemesDesktop) h["X-BM-Device"] = "windows|" + encodeURIComponent("beemes для Windows");
  if (session) h["X-BM-Session"] = session.id;
  return h;
}
let renewing = null;
/** Продлить вход секретом сеанса. → true, если получилось. */
export function renewToken() {
  if (!session) return Promise.resolve(false);
  if (!renewing) {
    renewing = (async () => {
      try {
        const res = await fetch(url("api/bm/session/renew"), {
          method: "POST", headers: { "Content-Type": "application/json", ...deviceHeaders() }, body: JSON.stringify({ id: session.id, secret: session.secret }),
        });
        if (!res.ok) return false;
        const r = await res.json();
        token = r.token;
        if (onRenewed) onRenewed(r);
        return true;
      } catch (_) { return false; }
    })().finally(() => { setTimeout(() => { renewing = null; }, 0); });
  }
  return renewing;
}

/** Запрос к серверу. body — объект (JSON) или FormData (файлы). */
export async function api(method, path, { body, query, keepalive, retried } = {}) {
  const headers = { ...deviceHeaders() };
  if (token) headers.Authorization = token;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined || method === "POST" || method === "PATCH") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(url(path, query), { method, headers, body: payload, keepalive });
  } catch (_) {
    throw new ApiError("Нет связи с сервером. Проверьте интернет.");
  }
  const text = await res.text();
  // Пропуск больше не действует (истёк или сеансы перезапустили) — продлеваем секретом сеанса и повторяем.
  if (res.status === 401 && !retried && token && session && !/auth-with-password|session\/renew/.test(path) && await renewToken()) {
    return api(method, path, { body, query, keepalive, retried: true });
  }
  if (!res.ok) throw parseError(res.status, text);
  return text ? JSON.parse(text) : {};
}

export const get = (path, query) => api("GET", path, { query });
export const post = (path, body) => api("POST", path, { body });
export const patch = (path, body) => api("PATCH", path, { body });
export const del = (path) => api("DELETE", path);

/** Скачать файл (байты). */
export async function download(path, query) {
  let res;
  try {
    res = await fetch(url(path, query), { headers: token ? { Authorization: token } : {} });
  } catch (_) {
    throw new ApiError("Нет связи с сервером. Проверьте интернет.");
  }
  if (!res.ok) throw new ApiError("Не получилось загрузить файл", res.status);
  return new Uint8Array(await res.arrayBuffer());
}

/** Адрес картинки профиля (null — нет фото). */
export const avatarUrl = (user, thumb = "160x160") =>
  user && user.avatar ? url(`api/files/users/${user.id}/${user.avatar}`, { thumb }) : null;
