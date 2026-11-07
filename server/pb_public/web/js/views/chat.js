/* Переписка: сообщения, фото, ответы, правка, живые эмодзи, звонки. */
import {
  h, icon, iconButton, avatar, nameWithStatus, lastSeenText, isOnline, timeOfDay, dayTitle, richText, bigEmoji, animoji,
  emojiGroups, popupMenu, modal, toast, disposeEmoji, accentOf, accentVars, titleOf, WALLPAPERS, wallpaperStyle, stickers, stickerUrl, groupAvatar, groupTitle, groupSubtitle,
} from "../ui.js";
import * as store from "../store.js";
import { callTitle, preview } from "./chats.js";
import { startCall } from "../calls.js";

/** Фото для отправки: до 1600 px по длинной стороне, JPEG 85 %, превью 24 px. */
export async function preparePhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const hgt = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = hgt;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, hgt);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const small = document.createElement("canvas");
  const ps = 24 / Math.max(w, hgt);
  small.width = Math.max(1, Math.round(w * ps)); small.height = Math.max(1, Math.round(hgt * ps));
  small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
  const preview = small.toDataURL("image/jpeg", 0.7).split(",")[1];
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: w, height: hgt, preview, url: URL.createObjectURL(blob) };
}

export function chatView(root, { chatId, go }) {
  const me = store.state.me;
  let peer = null;
  let replyTo = null;
  let editing = null;
  let hasMore = true;
  let loadingMore = false;
  let disposed = false;
  store.state.openChatId = chatId;

  // ---------- Шапка ----------
  let group = null; // группа или канал (иначе — личный чат с peer)
  const who = h("button", { type: "button", class: "chat-who", onclick: () => (group ? go(`#/group/${group.id}`) : peer && go(`#/user/${peer.id}`)) });
  const callVideo = iconButton("video", "Видеозвонок", () => startCall(chatId, true));
  const callAudio = iconButton("phone", "Позвонить", () => startCall(chatId, false));
  const header = h("header", { class: "chat-header" },
    iconButton("back", "К чатам", () => go("#/"), { class: "only-narrow" }),
    who, callVideo, callAudio,
    iconButton("more", "Ещё", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const item = store.chatItem(chatId);
      const muteItem = { icon: item && item.muted ? "bell" : "belloff", label: item && item.muted ? "Включить звук" : "Без звука", onclick: () => store.setMuted(chatId, !(item && item.muted)).catch((x) => toast(x.message)) };
      popupMenu(r.right - 220, r.bottom + 4, group ? [
        { icon: "info", label: group.type === "channel" ? "О канале" : "О группе", onclick: () => go(`#/group/${group.id}`) },
        group.joined ? { icon: "palette", label: "Фон чата", onclick: wallpaperPicker } : null,
        group.joined ? muteItem : null,
        group.isPublic || store.isAdminOf(group) ? { icon: "link", label: "Пригласить по ссылке", onclick: () => showInvite(group) } : null,
      ].filter(Boolean) : [
        { icon: "palette", label: "Фон чата", onclick: wallpaperPicker },
        muteItem,
        { icon: "lock", label: "Код безопасности", onclick: () => go(`#/safety/${chatId}`) },
      ]);
    }));
  const renderWho = () => {
    if (group) {
      disposeEmoji(who);
      who.replaceChildren(groupAvatar(group, 42), h("span", { class: "who-text" }, groupTitle(group, 18), h("span", { class: "who-status" }, groupSubtitle(group))));
      return;
    }
    if (!peer) return;
    const p = store.state.users.get(peer.id) || peer;
    disposeEmoji(who);
    who.replaceChildren(avatar(p, 42),
      h("span", { class: "who-text" }, nameWithStatus(p, 18), h("span", { class: "who-status" + (isOnline(p) ? " online" : "") }, lastSeenText(p))));
  };

  // ---------- Сообщения ----------
  const list = h("div", { class: "messages", role: "log", "aria-live": "polite", "aria-label": "Сообщения" });
  const scroller = h("div", { class: "scroller" }, list);

  // ---------- Фон чата ----------
  let shownWallpaper = null;
  async function applyWallpaper() {
    const value = store.wallpaperOf(chatId);
    if (value === shownWallpaper) return;
    shownWallpaper = value;
    let photoUrl = null;
    if (value.startsWith("photo:")) photoUrl = await store.wallpaperPhoto(chatId).catch(() => null);
    if (disposed || store.wallpaperOf(chatId) !== value) return;
    scroller.removeAttribute("style");
    const st = wallpaperStyle(value, photoUrl);
    if (st) Object.entries(st).forEach(([k, v]) => scroller.style.setProperty(k, v));
    scroller.classList.toggle("has-wallpaper", !!st);
    scroller.classList.toggle("photo-wallpaper", !!photoUrl);
  }
  function wallpaperPicker() {
    const current = store.wallpaperOf(chatId);
    const pick = async (v) => { dlg.close(); try { await store.setWallpaper(chatId, v); } catch (e) { toast(e.message); } };
    const file = h("input", { type: "file", accept: "image/*", hidden: true });
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      dlg.close();
      let prepared;
      try { prepared = await preparePhoto(f); } catch (_) { toast("Не получилось открыть это фото"); return; }
      URL.revokeObjectURL(prepared.url);
      toast("Ставим фон…", 1500);
      try { await store.setWallpaperPhoto(chatId, prepared); } catch (e) { toast(e.message); }
    };
    const tile = (value, label, style, extra) => h("button", {
      type: "button", class: "wp-item" + (current === value ? " selected" : "") + (extra || ""), style, "aria-label": label, "aria-pressed": current === value ? "true" : "false",
      onclick: () => pick(value),
    }, h("span", {}, label));
    const grid = h("div", { class: "wp-grid" },
      tile("", "Соты", null, " wp-default"),
      WALLPAPERS.map((w) => tile("p:" + w.id, w.name, wallpaperStyle("p:" + w.id))),
      h("button", { type: "button", class: "wp-item wp-photo" + (current.startsWith("photo:") ? " selected" : ""), onclick: () => file.click() }, icon("image", 28), h("span", {}, "Своё фото")),
      file);
    const dlg = modal("Фон чата", h("div", {}, h("p", { class: "muted small" }, "Фон этого чата видите только вы. Своё фото шифруется, как фото в переписке."), grid), [{ label: "Закрыть" }], { class: "wp-modal" });
  }

  function bubble(m) {
    const mine = m.senderId === me.id;
    const acc = accentOf(mine ? me : peer);
    const c = m.content;
    const big = c && m.kind === "text" && !m.replyTo ? bigEmoji(c.t) : null;
    const meta = h("span", { class: "meta" }, m.edited ? "изм. " : "", timeOfDay(m.created),
      mine ? (m.status === "sending" ? icon("clock", 14) : m.status === "failed" ? icon("error", 14) : icon(m.status === "read" ? "checks" : "check", 15)) : null);
    let body;
    if (c && m.kind === "sticker") {
      const src = stickerUrl(c.st);
      const art = src ? h("img", { class: "sticker-img", src, alt: (c.e || "") + " Стикер", width: 168, height: 168, loading: "lazy" })
        : h("div", { class: "big-emoji" }, c.e || "🐝");
      const el = h("div", { class: "msg-row big sticker" + (mine ? " mine" : ""), "data-id": m.id }, h("div", { class: "sticker-body", tabindex: "0" }, art, meta));
      const b = el.querySelector(".sticker-body");
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); messageMenu(m, e.clientX, e.clientY); });
      b.addEventListener("dblclick", () => setReply(m));
      return el;
    }
    if (!c) body = h("span", { class: "undecryptable" }, "🔒 Не удалось расшифровать сообщение");
    else if (big) {
      return h("div", { class: "msg-row big" + (mine ? " mine" : ""), "data-id": m.id },
        h("div", { class: "big-emoji" }, big.map((code) => animoji(code, big.length === 1 ? 120 : big.length === 2 ? 88 : 72)), meta));
    } else if (m.kind === "photo") body = photoBubble(m, c);
    else if (m.kind === "call") {
      const missed = c.s === "missed" || c.s === "declined";
      body = h("span", { class: "call-bubble" }, h("span", { class: "call-ic" + (missed && !mine ? " missed" : "") }, icon(missed ? "callmissed" : c.v ? "video" : "phone", 20)),
        h("span", {}, h("b", {}, callTitle(m, mine)), h("small", {}, mine ? "Исходящий" : "Входящий")));
    } else body = richText(c.t, "text");
    const quote = m.replyTo ? replyQuote(m.replyTo) : null;
    let author = null;
    if (group && group.type === "group" && !mine) {
      const u = store.state.users.get(m.senderId);
      if (!u) store.user(m.senderId).then(() => { lastRendered = ""; render(); }).catch(() => {});
      author = h("button", { type: "button", class: "sender-name", style: { color: accentOf(u || { id: m.senderId }).b }, onclick: () => go(`#/user/${m.senderId}`) }, u ? titleOf(u) : "…");
    }
    const el = h("div", { class: "msg-row" + (mine ? " mine" : ""), "data-id": m.id },
      h("div", { class: "bubble" + (m.kind === "photo" ? " photo" : ""), style: mine ? accentVars(acc) : null, tabindex: "0" }, author, quote, body, meta));
    if (m.status === "failed") {
      el.append(h("div", { class: "failed" }, m.error || "Не отправлено",
        h("button", { type: "button", class: "link", onclick: () => store.retry(m).catch(() => {}) }, "Повторить"),
        h("button", { type: "button", class: "link", onclick: () => store.discard(m) }, "Удалить")));
    }
    const b = el.querySelector(".bubble");
    const menu = (x, y) => messageMenu(m, x, y);
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); menu(e.clientX, e.clientY); });
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "ContextMenu") { const r = b.getBoundingClientRect(); menu(r.left + 20, r.bottom - 10); } });
    b.addEventListener("dblclick", () => setReply(m));
    return el;
  }

  function replyQuote(id) {
    const r = store.messagesOf(chatId).find((x) => x.id === id);
    const author = r ? (r.senderId === me.id ? "Вы" : titleOf(group ? store.state.users.get(r.senderId) : peer)) : "";
    return h("button", { type: "button", class: "quote", onclick: () => { const t = list.querySelector(`[data-id="${id}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1200); } } },
      h("b", {}, author || "Сообщение"), richText(r ? preview(r, "-") : "Сообщение удалено", "quote-text"));
  }

  function photoBubble(m, c) {
    const ratio = c.w && c.h ? Math.min(Math.max(c.h / c.w, 0.5), 1.4) : 0.75;
    const img = h("img", { alt: c.c || "Фото", class: "photo-img blur", style: { "aspect-ratio": `${1 / ratio}` } });
    if (c.p) img.src = "data:image/jpeg;base64," + c.p;
    const cached = store.cachedPhoto(m);
    if (cached) { img.src = cached; img.classList.remove("blur"); }
    else if (m.file) store.photo(m).then((u) => { if (u) { img.src = u; img.classList.remove("blur"); } }).catch(() => img.classList.add("broken"));
    const wrap = h("button", { type: "button", class: "photo-wrap", "aria-label": "Открыть фото", onclick: () => viewer(m) }, img);
    return h("span", { class: "photo-body" }, wrap, c.c ? richText(c.c, "text caption") : null);
  }

  function viewer(m) {
    const src = store.cachedPhoto(m);
    if (!src) return;
    const close = () => ov.remove();
    const ov = h("div", { class: "viewer", role: "dialog", "aria-label": "Фото", onclick: (e) => { if (e.target === ov) close(); } },
      h("img", { src, alt: (m.content && m.content.c) || "Фото" }),
      h("button", { type: "button", class: "icon-btn viewer-close", "aria-label": "Закрыть", onclick: close }, icon("close")),
      h("a", { class: "btn btn-outline viewer-save", href: src, download: "beemes-photo.jpg" }, "Сохранить"));
    document.body.append(ov);
    const key = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", key); } };
    document.addEventListener("keydown", key);
  }

  function messageMenu(m, x, y) {
    const mine = m.senderId === me.id;
    const items = [];
    if (m.status !== "sending" && m.status !== "failed") items.push({ icon: "reply", label: "Ответить", onclick: () => setReply(m) });
    if (m.content && (m.content.t || m.content.c)) items.push({ icon: "copy", label: "Копировать текст", onclick: () => navigator.clipboard.writeText(m.content.t || m.content.c).then(() => toast("Скопировано")) });
    if (mine && m.kind === "text" && m.content && m.status !== "failed") items.push({ icon: "edit", label: "Изменить", onclick: () => setEdit(m) });
    if (mine && m.status !== "sending" && m.status !== "failed") items.push({ icon: "trash", label: "Удалить у всех", danger: true, onclick: () => confirmDelete(m) });
    if (items.length) popupMenu(x, y, items);
  }

  function confirmDelete(m) {
    modal("Удалить сообщение?", h("p", {}, "Сообщение исчезнет у вас и у собеседника."), [
      { label: "Отмена" },
      { label: "Удалить", danger: true, onclick: (close) => { close(); store.remove(m).catch((e) => toast(e.message)); } },
    ]);
  }

  let lastRendered = "";
  function render(stick) {
    const msgs = store.messagesOf(chatId);
    const sig = msgs.map((m) => m.id + m.status + (m.edited ? "e" : "") + (m.content ? "c" : "")).join();
    if (sig === lastRendered) return;
    lastRendered = sig;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
    const prevHeight = scroller.scrollHeight;
    const prevTop = scroller.scrollTop;
    disposeEmoji(list);
    const out = [];
    if (!hasMore) {
      const note = !group ? "Сообщения и звонки зашифрованы. Прочитать их можете только вы и собеседник."
        : group.isPublic ? "Публичный канал: посты видит любой, кто его найдёт."
          : group.type === "channel" ? "Посты зашифрованы. Прочитать их могут только подписчики канала."
            : "Сообщения зашифрованы. Прочитать их могут только участники группы.";
      out.push(h("div", { class: "e2e-note" }, icon(group && group.isPublic ? "campaign" : "lock", 16), note));
    }
    if (!msgs.length && !hasMore) {
      out.push(h("div", { class: "empty-chat" }, h("button", { type: "button", class: "wave", "aria-label": "Отправить 👋", onclick: () => sendText("👋") }, animoji("1f44b", 110)),
        h("p", {}, "Напишите первым — или отправьте 👋")));
    }
    let lastDay = "";
    for (const m of msgs) {
      const day = m.created.toDateString();
      if (day !== lastDay) { out.push(h("div", { class: "day-chip" }, h("span", {}, dayTitle(m.created)))); lastDay = day; }
      out.push(bubble(m));
    }
    list.replaceChildren(...out);
    if (stick === "top") scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
    else if (stick || nearBottom) { scroller.scrollTop = scroller.scrollHeight; pinned = true; }
    if (document.hasFocus() && !document.hidden) store.markRead(chatId).catch(() => {});
  }

  let pinned = true;
  new ResizeObserver(() => { if (pinned) scroller.scrollTop = scroller.scrollHeight; }).observe(list);
  scroller.addEventListener("scroll", async () => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    if (scroller.scrollTop > 120 || !hasMore || loadingMore) return;
    const first = store.messagesOf(chatId).find((m) => m.status !== "sending" && m.status !== "failed");
    if (!first) return;
    loadingMore = true;
    try { hasMore = await store.loadMessages(chatId, first.created); } catch (_) { /* ignore */ }
    loadingMore = false;
    lastRendered = "";
    render("top");
  });

  // ---------- Поле ввода ----------
  const text = h("textarea", { class: "composer-input", rows: 1, placeholder: "Сообщение", "aria-label": "Сообщение", maxlength: 4000 });
  const bar = h("div", { class: "reply-bar", hidden: true });
  const emojiBtn = iconButton("smile", "Эмодзи", () => togglePanel());
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  const sendBtn = h("button", { type: "button", class: "send-btn", "aria-label": "Отправить", title: "Отправить (Enter)" }, icon("send", 22));
  const panel = h("div", { class: "emoji-panel", hidden: true });
  const composer = h("div", { class: "composer" }, bar,
    h("div", { class: "composer-row" }, emojiBtn, text, iconButton("image", "Фото", () => fileInput.click()), fileInput, sendBtn), panel);

  const autosize = () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 180) + "px"; };
  text.addEventListener("input", autosize);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === "Escape" && (replyTo || editing)) clearBar();
    if (e.key === "ArrowUp" && !text.value) {
      const lastMine = [...store.messagesOf(chatId)].reverse()
        .find((m) => m.senderId === me.id && m.kind === "text" && m.content && (m.status === "sent" || m.status === "read"));
      if (lastMine) { e.preventDefault(); setEdit(lastMine); }
    }
  });
  sendBtn.onclick = submit;

  function setReply(m) {
    editing = null;
    replyTo = m;
    bar.hidden = false;
    bar.replaceChildren(icon("reply", 20), h("span", { class: "bar-text" }, h("b", {}, m.senderId === me.id ? "Ответ себе" : "Ответ " + titleOf(peer)), richText(preview(m, "-"))), iconButton("close", "Отменить", clearBar));
    text.focus();
  }
  function setEdit(m) {
    replyTo = null;
    editing = m;
    bar.hidden = false;
    bar.replaceChildren(icon("edit", 20), h("span", { class: "bar-text" }, h("b", {}, "Правка"), richText(m.content.t)), iconButton("close", "Отменить", clearBar));
    text.value = m.content.t;
    autosize();
    text.focus();
  }
  function clearBar() {
    if (editing) text.value = "";
    replyTo = null; editing = null;
    bar.hidden = true;
    autosize();
  }
  async function sendText(t) {
    try { await store.sendText(chatId, t); } catch (_) { /* покажет «не отправлено» */ }
  }
  async function submit() {
    const t = text.value.trim();
    if (!t) return;
    if (editing) {
      const m = editing;
      clearBar(); text.value = ""; autosize();
      if (t !== m.content.t) store.edit(m, t).catch((e) => toast(e.message));
      return;
    }
    const reply = replyTo ? replyTo.id : "";
    text.value = ""; clearBar(); autosize();
    try { await store.sendText(chatId, t, reply); } catch (_) { /* покажет «не отправлено» */ }
  }

  // ---------- Эмодзи ----------
  let panelBuilt = false;
  function togglePanel() {
    panel.hidden = !panel.hidden;
    emojiBtn.replaceChildren(icon(panel.hidden ? "smile" : "keyboard"));
    emojiBtn.setAttribute("aria-label", panel.hidden ? "Эмодзи" : "Скрыть эмодзи");
    if (!panel.hidden && !panelBuilt) buildPanel();
    if (panel.hidden) text.focus();
  }
  function buildPanel() {
    panelBuilt = true;
    const groups = emojiGroups();
    const grid = h("div", { class: "emoji-grid", role: "listbox", "aria-label": "Эмодзи" });
    const tabs = h("div", { class: "emoji-tabs", role: "tablist" });
    const show = (gi) => {
      disposeEmoji(grid);
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.group === String(gi) ? "true" : "false"));
      grid.replaceChildren(...groups[gi].items.map((it) =>
        h("button", { type: "button", class: "emoji-cell", title: it.e, "aria-label": it.e,
          onclick: () => insert(it.e), ondblclick: () => store.sendText(chatId, it.e).catch(() => {}) }, animoji(it.c, 36, it.e))));
      grid.scrollTop = 0;
    };
    const hint = h("p", { class: "emoji-hint" }, "Щелчок — добавить в сообщение, двойной щелчок — отправить крупно");
    groups.forEach((g, i) => tabs.append(h("button", { type: "button", role: "tab", "data-group": String(i), onclick: () => { hint.textContent = "Щелчок — добавить в сообщение, двойной щелчок — отправить крупно"; show(i); } }, g.items[0] ? g.items[0].e + " " : "", g.title)));
    // Стикеры — отдельные вкладки (по набору), отправляются сразу.
    stickers().slice().reverse().forEach((pack) => tabs.prepend(h("button", { type: "button", role: "tab", class: "sticker-tab", onclick: (ev) => {
      hint.textContent = "Нажмите на стикер — он сразу отправится";
      disposeEmoji(grid);
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b === ev.currentTarget ? "true" : "false"));
      grid.replaceChildren(h("div", { class: "sticker-grid" }, pack.items.map((it) =>
        h("button", { type: "button", class: "sticker-cell", title: it.t || it.e, "aria-label": "Стикер " + (it.t || it.e),
          onclick: () => store.sendSticker(chatId, `${pack.id}/${it.id}`, it.e).catch((x) => toast(x.message)) },
        h("img", { src: `../stickers/${pack.id}/${it.id}.png`, alt: "", width: 96, height: 96, loading: "lazy" })))));
      grid.scrollTop = 0;
    } }, "🐝 Стикеры")));
    panel.append(tabs, grid, hint);
    if (groups.length) show(0);
  }
  function insert(e) {
    const s = text.selectionStart ?? text.value.length;
    text.value = text.value.slice(0, s) + e + text.value.slice(text.selectionEnd ?? s);
    text.selectionStart = text.selectionEnd = s + e.length;
    autosize();
  }

  // ---------- Фото ----------
  async function askPhoto(file) {
    if (!file || !file.type.startsWith("image/")) return;
    let prepared;
    try { prepared = await preparePhoto(file); } catch (_) { toast("Не получилось открыть это фото"); return; }
    const caption = h("input", { class: "input", placeholder: "Подпись (необязательно)", maxlength: 1000 });
    modal("Отправить фото", h("div", { class: "photo-send" }, h("img", { src: prepared.url, alt: "" }), caption,
      h("p", { class: "muted small" }, "🔒 Фото зашифруется перед отправкой.")), [
      { label: "Отмена", onclick: (close) => { URL.revokeObjectURL(prepared.url); close(); } },
      { label: "Отправить", primary: true, onclick: (close) => { close(); URL.revokeObjectURL(prepared.url); store.sendPhoto(chatId, prepared, caption.value).catch((e) => toast(e.message)); } },
    ]);
  }
  fileInput.onchange = () => { askPhoto(fileInput.files[0]); fileInput.value = ""; };
  text.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); askPhoto(f); }
  });
  // Подписчик канала не пишет: вместо поля ввода — «подписаться» или «без звука».
  const readonly = h("div", { class: "composer readonly", hidden: true });
  function setupComposer() {
    const subscriber = group && group.type === "channel" && !store.isAdminOf(group);
    composer.hidden = !!subscriber || (group && !group.joined);
    readonly.hidden = !composer.hidden;
    if (!readonly.hidden) {
      const item = store.chatItem(chatId);
      readonly.replaceChildren(!group.joined
        ? h("button", { type: "button", class: "btn btn-primary wide-btn", onclick: async () => {
          try { group = await store.joinPublic(group.id); group = await store.reloadChat(group.id); setupComposer(); renderWho(); toast("Вы подписались"); } catch (e) { toast(e.message); }
        } }, group.type === "channel" ? "Подписаться" : "Вступить")
        : h("button", { type: "button", class: "btn btn-text wide-btn", onclick: async () => {
          await store.setMuted(chatId, !(item && item.muted)).catch((x) => toast(x.message)); setupComposer();
        } }, item && item.muted ? "Включить уведомления" : "Выключить уведомления"));
    }
  }
  function showInvite(c) {
    const link = store.inviteLink(c);
    if (!link) { toast("Ссылка появится, когда придёт ключ группы"); return; }
    const input = h("input", { class: "input", value: link, readonly: true, "aria-label": "Ссылка-приглашение" });
    modal(c.type === "channel" ? "Пригласить в канал" : "Пригласить в группу", h("div", { class: "invite-box" },
      h("p", { class: "muted" }, c.isPublic ? "Публичный канал — по этой ссылке его откроет любой." : "По ссылке вступит любой, у кого она есть. Ключ шифрования — в самой ссылке, сервер его не видит."),
      input), [
      { label: "Закрыть" },
      { label: "Копировать", primary: true, onclick: async (close) => { try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); } catch (_) { input.select(); } close(); } },
    ]);
  }
  const pane = h("section", { class: "chat-pane", "aria-label": "Переписка" }, header, scroller, composer, readonly);
  pane.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) { e.preventDefault(); pane.classList.add("drop"); } });
  pane.addEventListener("dragleave", (e) => { if (e.target === pane || !pane.contains(e.relatedTarget)) pane.classList.remove("drop"); });
  pane.addEventListener("drop", (e) => { e.preventDefault(); pane.classList.remove("drop"); askPhoto([...e.dataTransfer.files].find((f) => f.type.startsWith("image/"))); });

  root.replaceChildren(pane);

  // ---------- Загрузка ----------
  const offs = [
    store.on("messages:" + chatId, () => render()),
    store.on("users", renderWho),
    store.on("wallpaper:" + chatId, applyWallpaper),
    store.on("chats", applyWallpaper),
  ];
  const onFocus = () => store.markRead(chatId).catch(() => {});
  window.addEventListener("focus", onFocus);
  (async () => {
    try {
      let c = await store.chat(chatId);
      if (store.isGroup(c)) {
        c = await store.reloadChat(chatId);
        group = c;
        callVideo.hidden = callAudio.hidden = true;
        setupComposer();
        store.healGroupKeys(c).catch(() => {});
      } else peer = await store.user(store.peerOf(c), true);
      renderWho();
      applyWallpaper();
      if (store.messagesOf(chatId).length) render(true);
      hasMore = await store.loadMessages(chatId);
      if (disposed) return;
      lastRendered = "";
      render(true);
      text.focus();
    } catch (e) {
      list.replaceChildren(h("p", { class: "form-error pad" }, e.status === 404 ? "Чат не найден" : e.message));
    }
  })();
  return () => {
    disposed = true;
    offs.forEach((f) => f());
    window.removeEventListener("focus", onFocus);
    if (store.state.openChatId === chatId) store.state.openChatId = null;
    disposeEmoji(pane);
  };
}
