/* Список чатов и поиск людей (левая колонка). */
import { h, icon, iconButton, avatar, nameWithStatus, isOnline, shortWhen, richText, animoji, popupMenu, toast, disposeEmoji, titleOf } from "../ui.js";
import * as store from "../store.js";

/** Короткий текст последнего сообщения. */
export function preview(msg, myId) {
  if (!msg) return "";
  const c = msg.content;
  const mine = msg.senderId === myId;
  let text;
  if (!c) text = "🔒 Не удалось расшифровать";
  else if (msg.kind === "photo") text = "📷 " + (c.c || "Фото");
  else if (msg.kind === "call") text = callTitle(msg, mine);
  else text = (c.t || "").replace(/\n/g, " ");
  return (mine && msg.kind !== "call" ? "Вы: " : "") + text;
}
export function callTitle(msg, mine) {
  const c = msg.content || {};
  if (c.s === "missed") return mine ? "Отменённый звонок" : "Пропущенный звонок";
  if (c.s === "declined") return "Звонок отклонён";
  return (c.v ? "Видеозвонок" : "Звонок") + (c.d > 0 ? ` · ${Math.floor(c.d / 60)}:${String(c.d % 60).padStart(2, "0")}` : "");
}

function row(item, active, go) {
  const me = store.state.me;
  const peer = store.state.users.get(item.peer.id) || item.peer;
  const last = item.last;
  const mine = last && last.senderId === me.id;
  const tick = mine && last.kind !== "call" ? icon(last.status === "read" ? "checks" : "check", 16) : null;
  if (tick) tick.classList.add("tick", last.status === "read" ? "read" : "sent");
  const el = h("a", { href: `#/chat/${item.chat.id}`, class: "chat-row" + (active ? " active" : ""), "aria-current": active ? "page" : null },
    h("span", { class: "avatar-wrap" }, avatar(peer, 52), isOnline(peer) ? h("span", { class: "online-dot", title: "в сети" }) : null),
    h("span", { class: "chat-main" },
      h("span", { class: "chat-line" }, nameWithStatus(peer, 18), item.muted ? icon("belloff", 15) : null,
        h("span", { class: "chat-time" }, tick, last ? shortWhen(last.created) : "")),
      h("span", { class: "chat-line" }, richText(preview(last, me.id), "chat-preview"),
        item.unread > 0 ? h("span", { class: "badge" + (item.muted ? " muted" : "") }, item.unread > 99 ? "99+" : item.unread) : null)));
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    popupMenu(e.clientX, e.clientY, [
      { icon: item.muted ? "bell" : "belloff", label: item.muted ? "Включить звук" : "Без звука", onclick: () => store.setMuted(item.chat.id, !item.muted).catch((x) => toast(x.message)) },
      { icon: "trash", label: "Убрать из списка", onclick: () => { store.hideChat(item.chat.id).catch((x) => toast(x.message)); if (active) go("#/"); } },
    ]);
  });
  return el;
}

export function chatList(root, { activeChat, go }) {
  const me = store.state.me;
  const list = h("nav", { class: "chat-list", "aria-label": "Чаты" });
  const header = h("header", { class: "side-header" },
    h("a", { href: "#/", class: "brand", "aria-label": "beemes" }, "bee", h("span", {}, "mes")),
    h("span", { class: "grow" }),
    iconButton("search", "Найти людей", () => go("#/search")),
    h("a", { href: "#/settings", class: "me-btn", "aria-label": "Настройки", title: "Настройки" }, avatar(me, 34)));
  const render = () => {
    disposeEmoji(list);
    const visible = store.state.chats.filter((i) => !i.hidden);
    if (!store.state.loaded) list.replaceChildren(h("p", { class: "muted center pad" }, "Загружаем чаты…"));
    else if (!visible.length) {
      list.replaceChildren(h("div", { class: "empty" }, animoji("1f41d", 110), h("h3", {}, "Пока нет чатов"),
        h("p", { class: "muted" }, "Найдите друга по @имени и напишите первым."),
        h("button", { type: "button", class: "btn btn-primary", onclick: () => go("#/search") }, "Найти людей")));
    } else list.replaceChildren(...visible.map((i) => row(i, i.chat.id === activeChat(), go)));
  };
  const fab = h("button", { type: "button", class: "fab", "aria-label": "Новый чат", title: "Новый чат", onclick: () => go("#/search") }, icon("pen", 24));
  root.replaceChildren(header, list, fab);
  render();
  const off = [store.on("chats", render), store.on("users", () => { if (!document.hidden) render(); })];
  return () => { off.forEach((f) => f()); disposeEmoji(list); };
}

export function search(root, { go }) {
  const input = h("input", { class: "input search-input", type: "search", placeholder: "@имя или имя", "aria-label": "Поиск людей", autocomplete: "off", spellcheck: "false" });
  const results = h("div", { class: "chat-list" }, h("div", { class: "empty" }, animoji("1f440", 72), h("p", { class: "muted" }, "Найдите человека по @имени — например, @alisa")));
  let timer = null;
  let seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(async () => {
      const my = ++seq;
      if (q.trim().replace(/^@/, "").length < 2) { results.replaceChildren(h("p", { class: "muted center pad" }, "Впишите хотя бы 2 буквы")); return; }
      try {
        const found = await store.search(q);
        if (my !== seq) return;
        disposeEmoji(results);
        results.replaceChildren(...(found.length ? found.map((u) =>
          h("a", { href: `#/user/${u.id}`, class: "chat-row" },
            h("span", { class: "avatar-wrap" }, avatar(u, 48), isOnline(u) ? h("span", { class: "online-dot" }) : null),
            h("span", { class: "chat-main" }, h("span", { class: "chat-line" }, nameWithStatus(u, 18)),
              h("span", { class: "chat-line" }, h("span", { class: "chat-preview" }, "@" + u.username + (u.bio ? " · " + u.bio : "")))))) :
          [h("p", { class: "muted center pad" }, "Никого не нашли")]));
      } catch (e) { results.replaceChildren(h("p", { class: "form-error pad" }, e.message)); }
    }, 300);
  });
  root.replaceChildren(
    h("header", { class: "side-header" }, iconButton("back", "Назад", () => go("#/")), h("h2", { class: "side-title" }, "Найти людей")),
    h("div", { class: "pad-x" }, input),
    results);
  input.focus();
  return () => disposeEmoji(results);
}

export const peerTitle = titleOf;
