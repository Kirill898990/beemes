/* Вход и регистрация. Ключи шифрования создаются здесь, в браузере. */
import { h, icon, animoji } from "../ui.js";
import * as store from "../store.js";

function shell(...children) {
  return h("div", { class: "auth" }, h("div", { class: "auth-comb", "aria-hidden": "true" }), h("div", { class: "auth-card" }, ...children));
}

let uid = 0;
function field(label, attrs = {}, hint = "") {
  const id = "f" + ++uid;
  const { prefix, ...rest } = attrs;
  const err = h("p", { class: "field-hint", id: id + "-hint" }, hint);
  const input = h("input", { class: "input", id, "aria-describedby": id + "-hint", ...rest });
  const wrap = h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label),
    h("span", { class: "input-wrap" + (prefix ? " has-prefix" : "") }, prefix ? h("span", { class: "input-prefix", "aria-hidden": "true" }, prefix) : null, input), err);
  return { wrap, input, hint: (text, bad) => { err.textContent = text; err.classList.toggle("bad", !!bad); } };
}

function passwordToggle(input) {
  const b = h("button", { type: "button", class: "pw-toggle", "aria-label": "Показать пароль", "aria-pressed": "false" }, "👁");
  b.onclick = () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", show ? "true" : "false");
    b.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
  };
  input.after(b);
}

export function welcome(root, go) {
  root.replaceChildren(shell(
    h("div", { class: "auth-hero" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 120, height: 135 })),
    h("h1", { class: "brand-title" }, "bee", h("span", {}, "mes")),
    h("p", { class: "auth-sub" }, "Мессенджер, в котором переписка видна только вам и собеседнику"),
    h("ul", { class: "features" },
      h("li", {}, animoji("1f512", 34), h("span", {}, h("b", {}, "Сквозное шифрование"), "Сообщения и фото шифруются прямо здесь. Даже сервер их не прочитает.")),
      h("li", {}, animoji("1f60d", 34), h("span", {}, h("b", {}, "Живые эмодзи"), "Сотни анимированных эмодзи — бесплатно.")),
      h("li", {}, h("span", { class: "feat-ic" }, "📞"), h("span", {}, h("b", {}, "Звонки и видео"), "Звоните голосом и по видео прямо из чата."))),
    h("button", { type: "button", class: "btn btn-primary btn-wide", onclick: () => go("#/register") }, "Создать аккаунт"),
    h("button", { type: "button", class: "btn btn-outline btn-wide", onclick: () => go("#/login") }, "У меня уже есть аккаунт"),
  ));
}

export function login(root, go, done) {
  // Вход по почте или телефону — если на сервере настроена почта или SMS
  const contactLink = h("button", { type: "button", class: "btn btn-text btn-wide", hidden: true, onclick: () => go("#/login-contact") }, "Войти по почте или телефону");
  store.authOptions().then((o) => {
    if (!o.email && !o.phone) return;
    contactLink.textContent = o.email && o.phone ? "Войти по почте или телефону" : o.email ? "Войти по почте" : "Войти по номеру телефона";
    contactLink.hidden = false;
  });
  const user = field("@имя", { autocomplete: "username", prefix: "@", autocapitalize: "off", spellcheck: "false" });
  const pass = field("Пароль", { type: "password", autocomplete: "current-password" });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Войти");
  // 2FA: после верного пароля — код из письма
  const code = field("Код из письма", { inputmode: "numeric", maxlength: 6, autocomplete: "one-time-code" });
  code.wrap.hidden = true;
  const codeNote = h("p", { class: "muted small", hidden: true });
  const form = h("form", { class: "auth-form", novalidate: true },
    user.wrap, pass.wrap, codeNote, code.wrap,
    h("p", { class: "muted small" }, "На новом устройстве переписка восстановится: ключ шифрования откроется вашим паролем."),
    err, btn,
    h("button", { type: "button", class: "btn btn-text btn-wide", onclick: () => go("#/qr-login") }, "Войти по QR-коду с телефона"),
    contactLink);
  passwordToggle(pass.input);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (!user.input.value.trim() || !pass.input.value) { err.textContent = "Впишите @имя и пароль"; return; }
    btn.disabled = true;
    btn.textContent = "Входим…";
    try {
      await store.login(user.input.value, pass.input.value, code.wrap.hidden ? "" : code.input.value);
      done();
    } catch (ex) {
      if (ex.twoFactor) {
        code.wrap.hidden = false;
        codeNote.hidden = false;
        codeNote.textContent = `🔐 Включена защита входа: мы отправили код на ${ex.twoFactor}.`;
        if (code.input.value) err.textContent = "Неверный код";
        code.input.focus();
      } else err.textContent = ex.message || "Не получилось войти";
      btn.disabled = false;
      btn.textContent = "Войти";
    }
  };
  root.replaceChildren(shell(
    h("div", { class: "auth-top" }, h("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onclick: () => go("#/welcome") }, icon("back")), h("h1", {}, "Вход")),
    h("div", { class: "auth-hero small" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 84, height: 95 })),
    form,
  ));
  user.input.focus();
}

export function register(root, go, done) {
  const name = field("Имя", { autocomplete: "name", maxlength: 64 }, "Так вас увидят собеседники");
  const user = field("@имя", { autocomplete: "username", prefix: "@", maxlength: 32, autocapitalize: "off", spellcheck: "false" }, "По нему вас найдут: латинские буквы, цифры и _");
  const pass = field("Пароль", { type: "password", autocomplete: "new-password" }, "Не меньше 8 символов");
  const pass2 = field("Повторите пароль", { type: "password", autocomplete: "new-password" });
  passwordToggle(pass.input);
  // Почта или телефон — необязательно: по ним можно входить без @имени (код придёт туда)
  const contact = field("Почта или телефон", { autocomplete: "email", autocapitalize: "off", spellcheck: "false", maxlength: 120 }, "Необязательно. По ним можно будет входить без @имени");
  const sendCode = h("button", { type: "button", class: "btn btn-outline btn-small" }, "Прислать код");
  const code = field("Код", { inputmode: "numeric", maxlength: 6, autocomplete: "one-time-code" });
  code.wrap.hidden = true;
  const contactBox = h("div", { class: "contact-box", hidden: true }, contact.wrap, sendCode, code.wrap);
  let codeFor = "";
  store.authOptions().then((o) => {
    if (!o.email && !o.phone) return;
    contact.wrap.querySelector("label").textContent = o.email && o.phone ? "Почта или телефон" : o.email ? "Почта" : "Телефон";
    if (!o.email) contact.input.setAttribute("inputmode", "tel");
    contactBox.hidden = false;
  });
  contact.input.addEventListener("input", () => { if (contact.input.value.trim() !== codeFor) { code.wrap.hidden = true; code.input.value = ""; } });
  sendCode.onclick = async () => {
    contact.hint("");
    sendCode.disabled = true;
    try {
      const r = await store.signupCode(contact.input.value);
      codeFor = contact.input.value.trim();
      contact.hint((r.kind === "phone" ? "SMS с кодом отправлено на " : "Письмо с кодом отправлено на ") + r.to);
      code.wrap.hidden = false;
      code.input.focus();
    } catch (ex) { contact.hint(ex.message, true); }
    sendCode.disabled = false;
  };
  const consent = h("input", { type: "checkbox", id: "consent" });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Создать аккаунт");
  let checkTimer = null;
  let free = null;
  user.input.addEventListener("input", () => {
    user.input.value = user.input.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
    free = null;
    clearTimeout(checkTimer);
    const v = user.input.value;
    if (v.length < 3) { user.hint("По нему вас найдут: латинские буквы, цифры и _"); return; }
    checkTimer = setTimeout(async () => {
      try {
        const r = await store.usernameFree(v);
        if (user.input.value !== v) return;
        free = !!r.free;
        user.hint(r.free ? "✓ Свободно" : r.reason || "Занято", !r.free);
      } catch (_) { /* проверим при отправке */ }
    }, 350);
  });
  const form = h("form", { class: "auth-form", novalidate: true },
    name.wrap, user.wrap, pass.wrap, pass2.wrap, contactBox,
    h("div", { class: "note-card" }, h("span", { class: "note-ic" }, "🔐"),
      h("p", {}, "Запомните пароль. Он защищает ключ шифрования вашей переписки: без пароля восстановить сообщения нельзя — даже нам.")),
    h("label", { class: "check-row", for: "consent" }, consent,
      h("span", {}, "Я соглашаюсь с ", h("a", { href: "../privacy.html", target: "_blank", rel: "noopener" }, "политикой конфиденциальности"))),
    err, btn);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    const problems = [];
    if (!name.input.value.trim()) problems.push("Впишите имя");
    if (user.input.value.length < 3) problems.push("@имя: от 3 символов");
    if (free === false) problems.push("Это @имя уже занято");
    if (pass.input.value.length < 8) problems.push("Пароль: не меньше 8 символов");
    if (pass.input.value !== pass2.input.value) problems.push("Пароли не совпадают");
    const wantContact = !contactBox.hidden && contact.input.value.trim();
    if (wantContact && (code.wrap.hidden || codeFor !== contact.input.value.trim())) problems.push("Нажмите «Прислать код» — или сотрите почту/телефон");
    else if (wantContact && code.input.value.trim().length !== 6) problems.push("Введите код из 6 цифр");
    if (!consent.checked) problems.push("Нужно согласие с политикой конфиденциальности");
    if (problems.length) { err.textContent = problems[0]; return; }
    btn.disabled = true;
    btn.textContent = "Создаём ключи шифрования…";
    try {
      await store.register(name.input.value, user.input.value, pass.input.value, wantContact ? contact.input.value : "", wantContact ? code.input.value : "");
      done();
    } catch (ex) {
      err.textContent = ex.message || "Не получилось создать аккаунт";
      btn.disabled = false;
      btn.textContent = "Создать аккаунт";
    }
  };
  root.replaceChildren(shell(
    h("div", { class: "auth-top" }, h("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onclick: () => go("#/welcome") }, icon("back")), h("h1", {}, "Новый аккаунт")),
    form,
  ));
  name.input.focus();
}

/**
 * Вход по почте или телефону: код → сервер называет аккаунт → пароль.
 * Пароль нужен всегда: им зашифрован ключ переписки (на сервере его нет).
 */
export function loginContact(root, go, done) {
  const contact = field("Почта или телефон", { autocomplete: "email", autocapitalize: "off", spellcheck: "false", maxlength: 120 });
  const code = field("Код", { inputmode: "numeric", maxlength: 6, autocomplete: "one-time-code" });
  const pass = field("Пароль", { type: "password", autocomplete: "current-password" });
  passwordToggle(pass.input);
  const who = h("div", { class: "note-card", hidden: true });
  const note = h("p", { class: "muted small" });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Прислать код");
  let stage = "contact";
  let found = null;
  const show = () => {
    contact.input.readOnly = stage !== "contact";
    code.wrap.hidden = stage !== "code";
    pass.wrap.hidden = stage !== "password";
    who.hidden = stage !== "password";
    btn.textContent = stage === "contact" ? "Прислать код" : stage === "code" ? "Дальше" : "Войти";
  };
  store.authOptions().then((o) => {
    contact.wrap.querySelector("label").textContent = o.email && o.phone ? "Почта или телефон" : o.phone ? "Телефон" : "Почта";
    if (!o.email) contact.input.setAttribute("inputmode", "tel");
  });
  const form = h("form", { class: "auth-form", novalidate: true }, contact.wrap, note, code.wrap, who, pass.wrap, err, btn,
    h("button", { type: "button", class: "btn btn-text btn-wide", onclick: () => go("#/login") }, "Войти по @имени"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    btn.disabled = true;
    try {
      if (stage === "contact") {
        const r = await store.loginCode(contact.input.value);
        note.textContent = (r.kind === "phone" ? "📱 Если номер привязан к аккаунту, на " : "✉️ Если почта привязана к аккаунту, на ") + r.to + " придёт код.";
        stage = "code";
        show();
        code.input.focus();
      } else if (stage === "code") {
        found = await store.loginVerify(contact.input.value, code.input.value);
        who.replaceChildren(h("span", { class: "note-ic" }, "🐝"), h("p", {}, "Аккаунт ", h("b", {}, found.name || found.username), " (@" + found.username + "). Введите пароль — он открывает ключ вашей переписки."));
        note.textContent = "";
        stage = "password";
        show();
        pass.input.focus();
      } else {
        await store.login(found.username, pass.input.value, "", found.ticket);
        done();
        return;
      }
    } catch (ex) { err.textContent = ex.message || "Не получилось"; }
    btn.disabled = false;
  };
  show();
  root.replaceChildren(shell(
    h("div", { class: "auth-top" }, h("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onclick: () => go("#/login") }, icon("back")), h("h1", {}, "Вход по коду")),
    h("div", { class: "auth-hero small" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 84, height: 95 })),
    form,
  ));
  contact.input.focus();
}

/** Вход сохранён, но ключа на этом устройстве нет — достаточно пароля. */
export function unlock(root, me, done, other) {
  const pass = field("Пароль", { type: "password", autocomplete: "current-password" });
  passwordToggle(pass.input);
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Открыть переписку");
  const form = h("form", { class: "auth-form", novalidate: true }, pass.wrap, err, btn,
    h("button", { type: "button", class: "btn btn-text", onclick: other }, "Войти в другой аккаунт"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (!pass.input.value) { err.textContent = "Впишите пароль"; return; }
    btn.disabled = true;
    btn.textContent = "Открываем…";
    try { await store.unlock(pass.input.value); done(); } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = "Открыть переписку"; }
  };
  root.replaceChildren(shell(
    h("div", { class: "auth-hero small" }, h("img", { class: "logo-float", src: "../img/logo.svg", alt: "", width: 84, height: 95 })),
    h("h1", { class: "unlock-title" }, "@" + (me.username || "")),
    h("p", { class: "auth-sub" }, "Вы вошли, но на этом устройстве нет ключа шифрования. Введите пароль — переписка откроется."),
    form,
  ));
  pass.input.focus();
}
