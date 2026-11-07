/* Устройства (откуда входили), вход по QR-коду, почта и 2FA. */
import { h, icon, iconButton, modal, toast, disposeEmoji, animoji } from "../ui.js";
import * as store from "../store.js";
import qrcode from "../vendor/qrcode.mjs";

const PLATFORM = { android: "Android", iphone: "iPhone", web: "Браузер", windows: "Windows" };
const when = (v) => {
  const d = new Date(String(v || "").replace(" ", "T"));
  if (isNaN(d)) return "";
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 2) return "активно только что";
  if (min < 60) return `${min} мин. назад`;
  return d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};
const HOW = { password: "вход по паролю", qr: "вход по QR-коду", otp: "вход по коду", app: "" };

function pane(root, title, go, ...body) {
  root.replaceChildren(h("section", { class: "profile-pane" },
    h("header", { class: "pane-header" }, iconButton("back", "Назад", () => go("#/settings"), { class: "only-narrow" }), h("h2", {}, title)),
    h("div", { class: "profile-body" }, ...body)));
}

/** QR-код картинкой (SVG). */
export function qrSvg(text, size = 240) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cell = size / (n + 8);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${(c + 4) * cell} ${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR-код для входа");
  svg.dataset.qr = text;
  svg.innerHTML = `<rect width="${size}" height="${size}" rx="18" fill="#fff"/><path d="${path}" fill="#15121F"/>`;
  return svg;
}

// ---------- Устройства ----------
export function devices(root, { go }) {
  const list = h("div", { class: "card" }, h("p", { class: "muted pad" }, "Загружаем…"));
  const load = async () => {
    try {
      const items = await store.sessions();
      list.replaceChildren(...items.map((s) => h("div", { class: "member-row" },
        h("span", { class: "device-ic" }, icon(s.platform === "web" ? "chat" : s.platform === "windows" ? "settings" : "phone", 22)),
        h("span", { class: "grow" }, h("b", {}, s.name || PLATFORM[s.platform] || "Устройство"),
          h("small", {}, [s.ip ? "IP " + s.ip : "", HOW[s.how] || "", s.current ? "это устройство" : when(s.lastActive)].filter(Boolean).join(" · "))),
        s.current ? h("span", { class: "role-chip" }, "вы здесь") : h("button", { type: "button", class: "btn btn-text danger-text", onclick: () => end(s) }, "Завершить"))));
      others.hidden = items.filter((s) => !s.current).length === 0;
    } catch (e) { list.replaceChildren(h("p", { class: "form-error pad" }, e.message)); }
  };
  const end = (s) => modal("Завершить сеанс?", h("p", {}, `На устройстве «${s.name}» нужно будет войти заново.`), [
    { label: "Отмена" },
    { label: "Завершить", danger: true, onclick: async (close) => { close(); try { await store.endSession(s.id); toast("Сеанс завершён"); load(); } catch (e) { toast(e.message); } } },
  ]);
  const others = h("button", { type: "button", class: "btn btn-outline", hidden: true, onclick: () => modal("Завершить все другие сеансы?", h("p", {}, "На всех устройствах, кроме этого, нужно будет войти заново."), [
    { label: "Отмена" },
    { label: "Завершить все", danger: true, onclick: async (close) => { close(); try { const r = await store.endOtherSessions(); toast(`Завершено: ${r.ended}`); load(); } catch (e) { toast(e.message); } } },
  ]) }, "Завершить все другие сеансы");
  pane(root, "Устройства", go,
    h("p", { class: "muted" }, "Где вы вошли в beemes: устройство, IP-адрес и когда оно было в сети. Не узнаёте устройство — завершите его сеанс."),
    list, others,
    h("section", { class: "section" }, h("h3", {}, "Войти на новом устройстве"),
      h("div", { class: "card pad" }, h("p", {}, "На компьютере откройте beemes.ru/web (или приложение для Windows) → «Войти по QR-коду». Потом в приложении beemes на телефоне: Настройки → Устройства → «Подключить устройство» и наведите камеру на QR-код. Пароль вводить не нужно."))));
  load();
  return () => {};
}

// ---------- Почта и 2FA ----------
export function security(root, { go }) {
  const body = h("div", { class: "form" });
  const render = () => {
    const me = store.state.me;
    const hasEmail = !!(me.email && me.verified);
    const email = h("input", { class: "input", type: "email", placeholder: "you@mail.ru", autocomplete: "email", "aria-label": "Почта", value: me.email || "" });
    const code = h("input", { class: "input", inputmode: "numeric", maxlength: 6, placeholder: "Код из письма", "aria-label": "Код из письма", autocomplete: "one-time-code" });
    const err = h("p", { class: "form-error", role: "alert" });
    const codeRow = h("div", { class: "form", hidden: true }, code,
      h("button", { type: "button", class: "btn btn-primary", onclick: async () => {
        err.textContent = "";
        try { await store.emailConfirm(code.value); toast("Почта подтверждена"); render(); } catch (e) { err.textContent = e.message; }
      } }, "Подтвердить"));
    const sendBtn = h("button", { type: "button", class: "btn btn-outline", onclick: async () => {
      err.textContent = "";
      try { const r = await store.emailStart(email.value); toast("Письмо отправлено на " + r.to); codeRow.hidden = false; code.focus(); } catch (e) { err.textContent = e.message; }
    } }, hasEmail ? "Сменить почту" : "Прислать код");
    const tfa = h("input", { type: "checkbox", class: "switch", checked: !!me.twoFactor, disabled: !hasEmail, "aria-label": "Подтверждение входа кодом из письма" });
    tfa.onchange = () => askPassword(tfa.checked ? "Включить подтверждение входа" : "Выключить подтверждение входа", async (pw) => {
      await store.setTwoFactor(tfa.checked, pw);
      toast(tfa.checked ? "2FA включена: при входе по паролю понадобится код из письма" : "2FA выключена");
      render();
    }, () => { tfa.checked = !tfa.checked; });
    body.replaceChildren(...[
      h("h3", {}, "Почта"),
      h("p", { class: "muted" }, hasEmail ? `Привязана: ${me.email}` : "Нужна для подтверждения входа. Почту видите только вы."),
      email, sendBtn, codeRow, err,
      hasEmail ? h("button", { type: "button", class: "btn btn-text danger-text", onclick: () => askPassword("Отвязать почту", async (pw) => { await store.emailRemove(pw); toast("Почта отвязана"); render(); }) }, "Отвязать почту") : null,
      h("h3", {}, "Двухфакторная защита"),
      h("label", { class: "row-item card" }, icon("shield"), h("span", {}, h("b", {}, "Код из письма при входе"),
        h("small", {}, hasEmail ? "При входе по паролю на новом устройстве попросим ещё код с вашей почты" : "Сначала привяжите почту")), tfa),
      h("p", { class: "muted small" }, "Вход по QR-коду с вашего телефона кода не требует: вы подтверждаете его сами."),
    ].filter(Boolean)); // без «null» на странице, когда почты ещё нет
  };
  pane(root, "Почта и 2FA", go, body);
  render();
  return () => {};
}

function askPassword(title, action, onCancel) {
  const pw = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "Ваш пароль", "aria-label": "Пароль" });
  const err = h("p", { class: "form-error" });
  modal(title, h("div", { class: "form" }, h("p", { class: "muted" }, "Подтвердите паролем."), pw, err), [
    { label: "Отмена", onclick: (close) => { close(); if (onCancel) onCancel(); } },
    { label: "Готово", primary: true, onclick: async (close) => { err.textContent = ""; try { await action(pw.value); close(); } catch (e) { err.textContent = e.message; } } },
  ], { onclose: undefined });
}

// ---------- Вход по QR-коду (новое устройство) ----------
export function qrLogin(root, go, done) {
  const box = h("div", { class: "qr-box" }, h("p", { class: "muted" }, "Создаём QR-код…"));
  let timer = null;
  let stopped = false;
  const start = async () => {
    clearTimeout(timer);
    try {
      const q = await store.qrLoginStart();
      if (stopped) return;
      box.replaceChildren(qrSvg(q.link),
        h("ol", { class: "qr-steps" },
          h("li", {}, "Откройте beemes на телефоне"),
          h("li", {}, "Настройки → Устройства → «Подключить устройство»"),
          h("li", {}, "Наведите камеру на этот QR-код и подтвердите")),
        h("p", { class: "muted small" }, "🔒 Ключ переписки придёт зашифрованным прямо для этого устройства."));
      const until = Date.now() + (q.expiresIn - 5) * 1000;
      const tick = async () => {
        if (stopped) return;
        if (Date.now() > until) { start(); return; }
        try {
          const st = await q.poll();
          if (st === "done") { done(); return; }
          if (st === "declined") { box.replaceChildren(h("p", { class: "form-error" }, "Вход отклонён на телефоне."), h("button", { type: "button", class: "btn btn-outline", onclick: start }, "Новый QR-код")); return; }
        } catch (e) { if (e.status === 404) { start(); return; } }
        timer = setTimeout(tick, 2000);
      };
      timer = setTimeout(tick, 2000);
    } catch (e) { box.replaceChildren(h("p", { class: "form-error" }, e.message)); }
  };
  root.replaceChildren(h("main", { class: "auth" }, h("div", { class: "auth-comb", "aria-hidden": "true" }),
    h("div", { class: "auth-card" },
      h("div", { class: "auth-top" }, h("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onclick: () => { stopped = true; go("#/login"); } }, icon("back")), h("h1", {}, "Вход по QR-коду")),
      box)));
  start();
  window.addEventListener("hashchange", () => { stopped = true; clearTimeout(timer); }, { once: true });
}

// ---------- Подтвердить вход нового устройства (открыли ссылку из QR на телефоне) ----------
export function qrApprove(root, { id, pub, go }) {
  const card = h("div", { class: "join-card" }, h("p", { class: "muted" }, "Проверяем…"));
  root.replaceChildren(h("section", { class: "profile-pane" }, card));
  (async () => {
    try {
      const info = await store.qrInfo(id);
      if (!(await store.canApproveQr())) {
        card.replaceChildren(animoji("1f512", 80), h("h2", {}, "Подтвердите в приложении"),
          h("p", { class: "muted" }, "В этом браузере ключ переписки защищён — передать его отсюда нельзя. Откройте beemes на телефоне: Настройки → Устройства → «Подключить устройство»."));
        return;
      }
      const yes = h("button", { type: "button", class: "btn btn-primary wide-btn" }, "Войти на этом устройстве");
      yes.onclick = async () => {
        yes.disabled = true;
        try { await store.qrApprove(id, pub); card.replaceChildren(animoji("2705", 80), h("h2", {}, "Готово"), h("p", { class: "muted" }, `«${info.name}» вошло в ваш аккаунт.`)); } catch (e) { toast(e.message); yes.disabled = false; }
      };
      card.replaceChildren(animoji("1f512", 80), h("h2", {}, "Войти на новом устройстве?"),
        h("p", {}, h("b", {}, info.name), info.ip ? ` · IP ${info.ip}` : ""),
        h("p", { class: "muted small" }, "Подтверждайте, только если этот QR-код показан на вашем устройстве."),
        yes, h("button", { type: "button", class: "btn btn-text", onclick: async () => { await store.qrDecline(id).catch(() => {}); go("#/"); } }, "Это не я"));
    } catch (e) { card.replaceChildren(h("h2", {}, "QR-код не работает"), h("p", { class: "muted" }, e.message)); }
  })();
  return () => disposeEmoji(root);
}
