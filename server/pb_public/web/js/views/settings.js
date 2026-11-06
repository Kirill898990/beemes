/* Настройки: мой профиль, оформление, уведомления, пароль, заблокированные, выход и удаление аккаунта. */
import { h, icon, iconButton, avatar, nameWithStatus, ACCENTS, accentOf, accentVars, animoji, emojiGroups, statusCode, modal, toast, disposeEmoji, titleOf } from "../ui.js";
import * as store from "../store.js";
import { askNotify, canNotify } from "../calls.js";

const row = (ic, title, sub, onclick, cls = "") =>
  h("button", { type: "button", class: "row-item " + cls, onclick }, icon(ic), h("span", {}, h("b", {}, title), sub ? h("small", {}, sub) : null), h("span", { class: "chev" }, "›"));

export function menu(root, { go, route }) {
  const me = store.state.me;
  const themeSeg = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Тема" },
    [["system", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([k, label]) =>
      h("button", { type: "button", role: "radio", "aria-checked": store.theme.get() === k ? "true" : "false", onclick: (e) => {
        store.theme.set(k);
        themeSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === e.currentTarget ? "true" : "false"));
      } }, label)));
  const notifyBtn = h("input", { type: "checkbox", class: "switch", checked: store.notifyOn.get() && canNotify() && Notification.permission === "granted", "aria-label": "Уведомления о сообщениях" });
  notifyBtn.onchange = async () => {
    if (notifyBtn.checked) {
      const p = await askNotify();
      if (p !== "granted") { notifyBtn.checked = false; toast(p === "unsupported" ? "Этот браузер не умеет показывать уведомления" : "Разрешите уведомления для этого сайта в настройках браузера"); return; }
    }
    store.notifyOn.set(notifyBtn.checked);
  };
  const active = (r) => (route === r ? " active" : "");
  root.replaceChildren(
    h("header", { class: "side-header" }, iconButton("back", "К чатам", () => go("#/")), h("h2", { class: "side-title" }, "Настройки")),
    h("div", { class: "settings" },
      h("a", { href: "#/settings/profile", class: "me-card" + active("profile") }, avatar(me, 60), h("span", {}, nameWithStatus(me, 22), h("small", {}, "@" + me.username)), icon("edit")),
      h("h3", {}, "Оформление"), h("div", { class: "card pad" }, themeSeg),
      h("h3", {}, "Уведомления"),
      h("div", { class: "card" }, h("label", { class: "row-item" }, icon("bell"), h("span", {}, h("b", {}, "Уведомления о сообщениях"), h("small", {}, "Когда окно beemes не на экране")), notifyBtn)),
      h("h3", {}, "Безопасность"),
      h("div", { class: "card" },
        row("key", "Сменить пароль", "Ключ шифрования перешифруется новым паролем", () => go("#/settings/password"), active("password")),
        row("block", "Заблокированные", null, () => go("#/settings/blocked"), active("blocked"))),
      h("div", { class: "card" },
        row("info", "О beemes", null, () => go("#/settings/about"), active("about")),
        h("a", { class: "row-item", href: "../privacy.html", target: "_blank", rel: "noopener" }, icon("shield"), h("span", {}, h("b", {}, "Политика конфиденциальности")), h("span", { class: "chev" }, "↗"))),
      h("div", { class: "card" },
        row("logout", "Выйти", null, confirmLogout, "danger"),
        row("delete_forever", "Удалить аккаунт", "Профиль, ключи и все чаты — навсегда", () => deleteAccount(me), "danger"))));
  return () => disposeEmoji(root);
}

function confirmLogout() {
  modal("Выйти из аккаунта?", h("p", {}, "Переписка останется на сервере зашифрованной. Чтобы снова её читать, войдите с тем же паролем."), [
    { label: "Отмена" },
    { label: "Выйти", danger: true, onclick: async (close) => { close(); await store.logout(); location.hash = "#/welcome"; } },
  ]);
}

function deleteAccount(me) {
  const input = h("input", { class: "input", placeholder: "@" + me.username, autocomplete: "off", spellcheck: "false" });
  const err = h("p", { class: "form-error" });
  modal("Удалить аккаунт?", h("div", {},
    h("p", {}, "Удалятся профиль, ключи шифрования и все ваши чаты с сообщениями — у собеседников тоже. Вернуть их будет нельзя."),
    h("p", {}, h("b", {}, `Чтобы подтвердить, введите своё имя: @${me.username}`)), input, err), [
    { label: "Отмена" },
    { label: "Удалить навсегда", danger: true, onclick: async (close) => {
      if (input.value.trim().replace(/^@/, "").toLowerCase() !== me.username) { err.textContent = "Имя не совпадает"; return; }
      try { await store.deleteAccount(); close(); location.hash = "#/welcome"; } catch (e) { err.textContent = e.message; }
    } },
  ]);
}

export function myProfile(root, { go }) {
  const me = store.state.me;
  let accent = me.accent || accentOf(me).key;
  let status = me.statusEmoji || "";
  const name = h("input", { class: "input", value: me.name || "", maxlength: 64, autocomplete: "name" });
  const bio = h("textarea", { class: "input", rows: 3, maxlength: 200 }, me.bio || "");
  const counter = h("small", { class: "muted" }, `${(me.bio || "").length}/200`);
  bio.addEventListener("input", () => { counter.textContent = `${bio.value.length}/200`; renderHead(); });
  name.addEventListener("input", () => renderHead());
  const hide = h("input", { type: "checkbox", class: "switch", checked: !!me.hideLastSeen, "aria-label": "Скрывать, когда я был(а) в сети" });
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  const head = h("div", { class: "profile-head" });
  const preview = () => ({ ...store.state.me, name: name.value, accent, statusEmoji: status });
  function renderHead() {
    disposeEmoji(head);
    const p = preview();
    Object.entries(accentVars(accentOf(p))).forEach(([k, v]) => head.style.setProperty(k, v));
    head.replaceChildren(
      iconButton("back", "Назад", () => go("#/settings"), { class: "on-color only-narrow" }),
      h("div", { class: "profile-hero" },
        h("button", { type: "button", class: "avatar-edit", "aria-label": "Сменить фото", onclick: () => fileInput.click() }, avatar(store.state.me, 132), h("span", { class: "avatar-cam" }, icon("camera", 22))),
        h("h1", {}, nameWithStatus(p, 30)), h("p", {}, "@" + p.username)));
  }
  const accents = h("div", { class: "accents", role: "radiogroup", "aria-label": "Цвет профиля" });
  const renderAccents = () => accents.replaceChildren(...ACCENTS.map((a) =>
    h("button", { type: "button", role: "radio", class: "accent", "aria-label": a.title, title: a.title, "aria-checked": a.key === accent ? "true" : "false", style: accentVars(a),
      onclick: () => { accent = a.key; renderAccents(); renderHead(); } })));
  const statusBox = h("div", { class: "status-box" });
  const renderStatus = () => {
    disposeEmoji(statusBox);
    const code = statusCode(status);
    statusBox.replaceChildren(h("span", { class: "status-preview" }, code ? animoji(code, 40) : "😶"),
      h("span", {}, h("b", {}, "Эмодзи-статус"), h("small", {}, "Живой эмодзи рядом с вашим именем")),
      h("button", { type: "button", class: "btn btn-text", onclick: pickStatus }, code ? "Сменить" : "Выбрать"),
      code ? h("button", { type: "button", class: "btn btn-text", onclick: () => { status = ""; renderStatus(); renderHead(); } }, "Убрать") : null);
  };
  function pickStatus() {
    const grid = h("div", { class: "emoji-grid tall" }, emojiGroups().flatMap((g) => g.items).map((it) =>
      h("button", { type: "button", class: "emoji-cell", "aria-label": it.e, onclick: () => { status = it.c; renderStatus(); renderHead(); dlg.close(); } }, animoji(it.c, 36, it.e))));
    const dlg = modal("Эмодзи-статус", grid, [{ label: "Закрыть" }], { class: "wide", onclose: () => disposeEmoji(grid) });
  }
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
      const side = Math.min(bmp.width, bmp.height);
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      await store.setAvatar(blob);
      renderHead();
      toast("Фото обновлено");
    } catch (e) { toast(e.message || "Не получилось загрузить фото"); }
  };
  const err = h("p", { class: "form-error" });
  const save = h("button", { type: "button", class: "btn btn-primary" }, "Сохранить");
  save.onclick = async () => {
    err.textContent = "";
    if (!name.value.trim()) { err.textContent = "Впишите имя"; return; }
    save.disabled = true;
    try {
      await store.updateProfile({ name: name.value.trim(), bio: bio.value.trim(), accent, statusEmoji: status, hideLastSeen: hide.checked });
      toast("Сохранено");
    } catch (e) { err.textContent = e.message; }
    save.disabled = false;
  };
  const pane = h("section", { class: "profile-pane" }, head, fileInput,
    h("div", { class: "profile-body form" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Имя"), name),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "О себе"), bio, counter),
      h("h3", {}, "Цвет профиля"), accents, h("p", { class: "muted small" }, "Им красятся ваши сообщения и шапка профиля."),
      statusBox,
      h("label", { class: "row-item card" }, h("span", {}, h("b", {}, "Скрывать, когда я был(а) в сети"), h("small", {}, "Собеседники увидят «был(а) недавно»")), hide),
      store.state.me.avatar ? h("button", { type: "button", class: "btn btn-text", onclick: async () => { await store.setAvatar(null).catch((e) => toast(e.message)); renderHead(); } }, "Убрать фото профиля") : null,
      err, save));
  root.replaceChildren(pane);
  renderHead(); renderAccents(); renderStatus();
  return () => disposeEmoji(pane);
}

export function password(root, { go }) {
  const old = h("input", { class: "input", type: "password", autocomplete: "current-password" });
  const p1 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
  const p2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary" }, "Сменить пароль");
  const form = h("form", { class: "profile-body form" },
    h("p", { class: "muted" }, "Копия вашего ключа шифрования на сервере перешифруется новым паролем — переписка останется доступной."),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Текущий пароль"), old),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Новый пароль"), p1, h("small", { class: "muted" }, "Не меньше 8 символов")),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Повторите новый пароль"), p2),
    err, btn);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (p1.value.length < 8) { err.textContent = "Новый пароль: не меньше 8 символов"; return; }
    if (p1.value !== p2.value) { err.textContent = "Пароли не совпадают"; return; }
    btn.disabled = true; btn.textContent = "Меняем…";
    try { await store.changePassword(old.value, p1.value); toast("Пароль изменён"); go("#/settings"); } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false; btn.textContent = "Сменить пароль";
  };
  root.replaceChildren(h("section", { class: "profile-pane" }, h("header", { class: "pane-header" }, iconButton("back", "Назад", () => go("#/settings"), { class: "only-narrow" }), h("h2", {}, "Сменить пароль")), form));
  old.focus();
}

export function blockedList(root, { go }) {
  const list = h("div", { class: "card" }, h("p", { class: "muted pad" }, "Загружаем…"));
  const load = async () => {
    try {
      const items = await store.blocked();
      list.replaceChildren(...(items.length ? items.map((b) => {
        const u = (b.expand && b.expand.blocked) || { id: b.blocked };
        return h("div", { class: "row-item" }, avatar(u, 40), h("span", {}, h("b", {}, titleOf(u)), u.username ? h("small", {}, "@" + u.username) : null),
          h("button", { type: "button", class: "btn btn-text", onclick: async () => { await store.unblock(b.blocked).catch((e) => toast(e.message)); load(); } }, "Разблокировать"));
      }) : [h("p", { class: "muted pad" }, "Вы никого не блокировали.")]));
    } catch (e) { list.replaceChildren(h("p", { class: "form-error pad" }, e.message)); }
  };
  root.replaceChildren(h("section", { class: "profile-pane" }, h("header", { class: "pane-header" }, iconButton("back", "Назад", () => go("#/settings"), { class: "only-narrow" }), h("h2", {}, "Заблокированные")), h("div", { class: "profile-body" }, list)));
  load();
}

export function about(root, { go }) {
  const pane = h("section", { class: "profile-pane" }, h("header", { class: "pane-header" }, iconButton("back", "Назад", () => go("#/settings"), { class: "only-narrow" }), h("h2", {}, "О beemes")),
    h("div", { class: "about" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 110, height: 124 }),
      h("h1", { class: "brand-title" }, "bee", h("span", {}, "mes")),
      h("p", { class: "muted" }, "Веб-версия и приложение для Windows"),
      h("p", {}, "Сообщения, фото и звонки зашифрованы на устройствах (X25519, AES-256-GCM, WebRTC DTLS-SRTP). Сервер хранит только зашифрованные данные и не может их прочитать."),
      h("p", { class: "muted small" }, "Анимированные эмодзи — Noto Emoji Animation, © Google, CC BY 4.0. Анимация — lottie-web (MIT)."),
      h("a", { class: "btn btn-outline", href: "../", target: "_blank", rel: "noopener" }, "Сайт beemes и приложение для Android")));
  root.replaceChildren(pane);
  return () => disposeEmoji(pane);
}
