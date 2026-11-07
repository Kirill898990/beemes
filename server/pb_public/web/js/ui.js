/* Общие кусочки интерфейса: элементы, аватары-соты, цвета профиля, время, иконки, окна, живые эмодзи. */
import { avatarUrl } from "./api.js";

// ---------- Элементы ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.entries(v).forEach(([p, val]) => el.style.setProperty(p, val));
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Иконки (Material, контур) ----------
const P = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  phone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  video: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  smile: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z",
  image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  checks: "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  shield: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z",
  block: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z",
  bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
  palette: "M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  belloff: "M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z",
  moon: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
  key: "M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
  info: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  logout: "M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  camera: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z",
  chat: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  callmissed: "M19.59 7L12 14.59 6.41 9H11V7H3v8h2v-4.59l7 7 9-9z",
  delete_forever: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z",
  keyboard: "M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z",
  pen: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z",
};
export function icon(name, size = 24) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ic");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", P[name] || "");
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}
export const iconButton = (name, label, onclick, extra = {}) =>
  h("button", { type: "button", class: "icon-btn " + (extra.class || ""), "aria-label": label, title: label, onclick }, icon(name, extra.size || 24));

// ---------- Цвета профиля (как в приложении) ----------
export const ACCENTS = [
  { key: "honey", title: "Мёд", a: "#FFC23D", b: "#FF8A00", on: "#221800" },
  { key: "sunset", title: "Закат", a: "#FF8A5B", b: "#FF3D77", on: "#fff" },
  { key: "rose", title: "Роза", a: "#FF7AC0", b: "#B84BFF", on: "#fff" },
  { key: "violet", title: "Лаванда", a: "#A08CFF", b: "#5B45F0", on: "#fff" },
  { key: "ocean", title: "Океан", a: "#4FC3F7", b: "#2F6BFF", on: "#fff" },
  { key: "mint", title: "Мята", a: "#45E0B0", b: "#119C7A", on: "#221800" },
  { key: "lime", title: "Лайм", a: "#B7EB4A", b: "#3FAE2A", on: "#221800" },
  { key: "graphite", title: "Графит", a: "#8E8AA3", b: "#433E57", on: "#fff" },
  { key: "cherry", title: "Вишня", a: "#FF6B6B", b: "#C2185B", on: "#fff" },
  { key: "coral", title: "Коралл", a: "#FFAB91", b: "#FF5E3A", on: "#fff" },
  { key: "peach", title: "Персик", a: "#FFD3A5", b: "#FD9F6B", on: "#2B1400" },
  { key: "lemon", title: "Лимон", a: "#FFF27A", b: "#F5B700", on: "#221800" },
  { key: "forest", title: "Лес", a: "#6BCB77", b: "#1E7B3A", on: "#fff" },
  { key: "teal", title: "Бирюза", a: "#5EE7DF", b: "#0E8C8C", on: "#04282A" },
  { key: "sky", title: "Небо", a: "#A1C4FD", b: "#4F8DFD", on: "#0B1A33" },
  { key: "indigo", title: "Индиго", a: "#8C9EFF", b: "#3949AB", on: "#fff" },
  { key: "plum", title: "Слива", a: "#D58CFF", b: "#7B1FA2", on: "#fff" },
  { key: "berry", title: "Ягоды", a: "#FF6FA8", b: "#9C1458", on: "#fff" },
  { key: "cocoa", title: "Какао", a: "#C69C7B", b: "#6D4C41", on: "#fff" },
  { key: "midnight", title: "Полночь", a: "#6A5ACD", b: "#1A1446", on: "#fff" },
];
/** Сколько цветов было сначала: тем, кто цвет не выбирал, он подбирается из них (чтобы не поменялся). */
const FIRST_ACCENTS = 8;
/** Цвет человека: выбранный в профиле, иначе — по id (у каждого свой). */
export function accentOf(user) {
  const found = user && ACCENTS.find((x) => x.key === user.accent);
  if (found) return found;
  let hash = 0;
  for (const ch of String((user && user.id) || "")) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return ACCENTS[Math.abs(hash) % FIRST_ACCENTS];
}
export const accentVars = (acc) => ({ "--a1": acc.a, "--a2": acc.b, "--on": acc.on });

export const titleOf = (u) => (u && (u.name || (u.username ? "@" + u.username : ""))) || "Без имени";

/** Аватар-сота: фото или первая буква на цвете профиля. */
export function avatar(user, size = 48) {
  const acc = accentOf(user);
  const el = h("span", { class: "hex-avatar", style: { "--size": size + "px", ...accentVars(acc) }, "aria-hidden": "true" });
  const src = avatarUrl(user, size > 100 ? "480x480" : "160x160");
  if (src) {
    const img = h("img", { src, alt: "", loading: "lazy" });
    img.onerror = () => { img.remove(); el.textContent = initial(user); };
    el.append(img);
  } else el.textContent = initial(user);
  return el;
}
const initial = (u) => Array.from(titleOf(u).replace(/^@/, ""))[0]?.toUpperCase() || "?";

// ---------- Время ----------
const ru = "ru-RU";
const sameDay = (a, b) => a.toDateString() === b.toDateString();
export const timeOfDay = (d) => d.toLocaleTimeString(ru, { hour: "2-digit", minute: "2-digit" });
export function shortWhen(d) {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return timeOfDay(d);
  if (sameDay(d, y)) return "вчера";
  if (now - d < 6 * 864e5) return d.toLocaleDateString(ru, { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(ru, { day: "numeric", month: "short" }).replace(".", "");
  return d.toLocaleDateString(ru);
}
export function dayTitle(d) {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Сегодня";
  if (sameDay(d, y)) return "Вчера";
  return d.toLocaleDateString(ru, d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
}
export const when = (v) => (v ? new Date(String(v).replace(" ", "T")).getTime() : 0);
/** «В сети»: до onlineUntil (его продлевает открытое приложение). Старые записи — по lastSeen. */
export const isOnline = (u) => {
  if (!u) return false;
  if (u.onlineUntil !== undefined) return when(u.onlineUntil) > Date.now();
  return !!u.lastSeen && Date.now() - when(u.lastSeen) < 120000;
};
export function lastSeenText(u) {
  if (isOnline(u)) return "в сети";
  if (!u || !u.lastSeen) return u && u.hideLastSeen ? "был(а) недавно" : "был(а) давно";
  const d = new Date(String(u.lastSeen).replace(" ", "T"));
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return "был(а) только что";
  if (min < 60) return `был(а) ${min} мин. назад`;
  const now = new Date();
  if (sameDay(d, now)) return `был(а) в ${timeOfDay(d)}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `был(а) вчера в ${timeOfDay(d)}`;
  return `был(а) ${d.toLocaleDateString(ru, { day: "numeric", month: "long" })}`;
}
export const duration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------- Живые эмодзи (Lottie) ----------
let groups = [];
let byChar = new Map();
let sorted = [];
const jsonCache = new Map();
export async function loadEmoji() {
  try {
    groups = await (await fetch("../emoji/index.json")).json();
  } catch (_) { groups = []; }
  byChar = new Map();
  for (const g of groups) for (const it of g.items) { byChar.set(it.e, it.c); byChar.set(it.e.replace(/️/g, ""), it.c); }
  sorted = [...byChar.keys()].sort((a, b) => b.length - a.length);
}
export const emojiGroups = () => groups;

// ---------- Стикеры ----------
let stickerPacks = [];
export async function loadStickers() {
  try { stickerPacks = await (await fetch("../stickers/index.json")).json(); } catch (_) { stickerPacks = []; }
}
export const stickers = () => stickerPacks;
/** Картинка стикера по «набор/имя» (null — такого нет). */
export function stickerUrl(st) {
  if (!/^[a-z0-9]+\/[a-z0-9]+$/.test(st || "")) return null;
  const [pack, id] = st.split("/");
  const p = stickerPacks.find((x) => x.id === pack);
  return p && p.items.some((i) => i.id === id) ? `../stickers/${pack}/${id}.png` : null;
}
export const codeOf = (e) => byChar.get(e) || byChar.get(e.replace(/️/g, "")) || null;
export const statusCode = (v) => (!v ? null : /^[0-9a-f_]+$/.test(v) ? v : codeOf(v));
export const charOf = (code) => {
  for (const g of groups) for (const it of g.items) if (it.c === code) return it.e;
  return String.fromCodePoint(...code.split("_").map((x) => parseInt(x, 16)));
};

/** Текст → части: обычный текст и анимированные эмодзи. */
export function splitEmoji(text) {
  if (!sorted.length || !text) return [{ text }];
  const out = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const match = c >= 0xd800 && c <= 0xdbff || c >= 0x2190 ? sorted.find((e) => text.startsWith(e, i)) : null;
    if (match) {
      if (buf) { out.push({ text: buf }); buf = ""; }
      let len = match.length;
      if (text[i + len] === "️") len++;
      out.push({ emoji: text.slice(i, i + len), code: byChar.get(match) });
      i += len;
    } else { buf += text[i]; i++; }
  }
  if (buf) out.push({ text: buf });
  return out;
}
/** Сообщение только из 1–3 анимированных эмодзи → коды (показываем крупно). */
export function bigEmoji(text) {
  const parts = splitEmoji((text || "").trim());
  if (!parts.length || parts.length > 3 || parts.some((p) => !p.code)) return null;
  return parts.map((p) => p.code);
}

const players = new Map();
// У некоторых анимаций героиня улетает вдаль (пчела 🐝 большую часть времени — точка): крутим только кадры, где её видно.
const SEGMENTS = { "1f41d": [255, 329] };
const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = players.get(e.target);
    if (e.isIntersecting) { if (!p) mount(e.target); else p.play(); } else if (p) p.pause();
  }
}, { rootMargin: "100px" }) : null;
const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

async function mount(el) {
  const code = el.dataset.code;
  if (!window.lottie) { el.textContent = charOf(code); return; }
  try {
    if (!jsonCache.has(code)) jsonCache.set(code, fetch(`../emoji/${code}.json`).then((r) => (r.ok ? r.text() : Promise.reject())));
    const text = await jsonCache.get(code);
    if (!el.isConnected) return;
    const segment = SEGMENTS[code];
    const anim = window.lottie.loadAnimation({
      container: el, renderer: "svg", loop: !reduced, autoplay: !reduced && !segment, animationData: JSON.parse(text),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    if (segment) { if (reduced) anim.goToAndStop(segment[0], true); else anim.playSegments(segment, true); }
    players.set(el, anim);
  } catch (_) {
    el.textContent = charOf(code);
  }
}

/** Живой эмодзи по коду (size — px или "1.35em"). */
export function animoji(code, size = 32, label = "") {
  const el = h("span", { class: "animoji", "data-code": code, role: "img", "aria-label": label || charOf(code), style: { "--s": typeof size === "number" ? size + "px" : size } });
  if (observer) observer.observe(el); else mount(el);
  return el;
}
/** Отключить анимации внутри элемента, который убираем со страницы (экономим память). */
export function disposeEmoji(root) {
  root.querySelectorAll(".animoji").forEach((el) => {
    const p = players.get(el);
    if (p) { p.destroy(); players.delete(el); }
    if (observer) observer.unobserve(el);
  });
}

/** Текст с живыми эмодзи внутри. */
export function richText(text, cls = "") {
  const el = h("span", { class: cls });
  for (const p of splitEmoji(text || "")) el.append(p.code ? animoji(p.code, "1.35em", p.emoji) : linkify(p.text));
  return el;
}
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    frag.append(h("a", { href: m[0], target: "_blank", rel: "noopener noreferrer" }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** Имя и эмодзи-статус. */
export function nameWithStatus(user, emojiSize = 20) {
  const code = statusCode(user && user.statusEmoji);
  return h("span", { class: "name-status" }, h("span", { class: "name" }, titleOf(user)), code ? animoji(code, emojiSize) : null);
}

// ---------- Фоны чатов ----------
/** Готовые фоны: градиент и соты поверх. Те же имена в приложении для Android. */
export const WALLPAPERS = [
  { id: "sunset", name: "Закат", a: "#FFB25B", b: "#FF5E8A" },
  { id: "ocean", name: "Океан", a: "#3D8BFF", b: "#36D1C4" },
  { id: "mint", name: "Мята", a: "#9BEFC8", b: "#2BB673" },
  { id: "lavender", name: "Лаванда", a: "#C7B6FF", b: "#7D5CFF" },
  { id: "sakura", name: "Сакура", a: "#FFD0E2", b: "#FF7EB3" },
  { id: "sky", name: "Небо", a: "#CDEBFF", b: "#7FB2FF" },
  { id: "peach", name: "Персик", a: "#FFE0C2", b: "#FF9F7A" },
  { id: "sand", name: "Песок", a: "#FBEBC4", b: "#E6BC6E" },
  { id: "forest", name: "Лес", a: "#3E7D5C", b: "#163828" },
  { id: "night", name: "Ночь", a: "#352B5A", b: "#0E0B19" },
  { id: "berry", name: "Ягоды", a: "#8E2D6B", b: "#2A0E2F" },
  { id: "graphite", name: "Графит", a: "#55555F", b: "#1C1C22" },
];
const COMB = (color) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='42' height='72.75' viewBox='0 0 56 97'%3E%3Cpath d='M28 1 54 16v30L28 61 2 46V16z M28 61v36' fill='none' stroke='${color}' stroke-opacity='.16' stroke-width='2.4'/%3E%3C/svg%3E")`;
/** CSS фона по значению wallpaper ("p:<имя>"); photoUrl — расшифрованное своё фото. null — обычный фон. */
export function wallpaperStyle(value, photoUrl) {
  if (photoUrl) return { "background-image": `url("${photoUrl}")`, "background-size": "cover", "background-position": "center" };
  const w = WALLPAPERS.find((x) => "p:" + x.id === value);
  if (!w) return null;
  return { "background-image": `${COMB("%23FFFFFF")}, linear-gradient(160deg, ${w.a}, ${w.b})`, "background-size": "42px 72.75px, cover", "background-attachment": "local, fixed" };
}

// ---------- Окна, подсказки, меню ----------
export function toast(text, ms = 3200) {
  const el = h("div", { class: "toast", role: "status" }, text);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, ms);
}

/** Модальное окно. actions: [{ label, primary, danger, onclick(close) }]. */
export function modal(title, body, actions = [{ label: "Закрыть" }], opts = {}) {
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); if (opts.onclose) opts.onclose(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const box = h("div", { class: "modal " + (opts.class || ""), role: "dialog", "aria-modal": "true", "aria-label": title || "Окно" },
    title ? h("h2", { class: "modal-title" }, title) : null,
    h("div", { class: "modal-body" }, body),
    actions.length ? h("div", { class: "modal-actions" }, actions.map((a) =>
      h("button", { type: "button", class: "btn " + (a.primary ? "btn-primary" : a.danger ? "btn-danger" : "btn-text"), disabled: a.disabled, onclick: () => (a.onclick ? a.onclick(close) : close()) }, a.label))) : null);
  const back = h("div", { class: "modal-back", onclick: (e) => { if (e.target === back && !opts.sticky) close(); } }, box);
  document.body.append(back);
  document.addEventListener("keydown", onKey);
  const first = box.querySelector("input, textarea, button.btn-primary, button");
  if (first) setTimeout(() => first.focus(), 30);
  return { close, box };
}

/** Контекстное меню у курсора. items: [{ icon, label, danger, onclick }]. */
export function popupMenu(x, y, items) {
  document.querySelectorAll(".popup-menu").forEach((m) => m.remove());
  const menu = h("div", { class: "popup-menu", role: "menu" }, items.map((it) =>
    h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : "", onclick: () => { menu.remove(); it.onclick(); } }, icon(it.icon, 20), it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", off, true); } };
  setTimeout(() => document.addEventListener("mousedown", off, true), 0);
  menu.querySelector("button")?.focus();
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.remove(); });
  return menu;
}
