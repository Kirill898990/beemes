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
  const user = field("@имя", { autocomplete: "username", prefix: "@", autocapitalize: "off", spellcheck: "false" });
  const pass = field("Пароль", { type: "password", autocomplete: "current-password" });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-primary btn-wide" }, "Войти");
  const form = h("form", { class: "auth-form", novalidate: true },
    user.wrap, pass.wrap,
    h("p", { class: "muted small" }, "На новом устройстве переписка восстановится: ключ шифрования откроется вашим паролем."),
    err, btn);
  passwordToggle(pass.input);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (!user.input.value.trim() || !pass.input.value) { err.textContent = "Впишите @имя и пароль"; return; }
    btn.disabled = true;
    btn.textContent = "Входим…";
    try {
      await store.login(user.input.value, pass.input.value);
      done();
    } catch (ex) {
      err.textContent = ex.message || "Не получилось войти";
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
    name.wrap, user.wrap, pass.wrap, pass2.wrap,
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
    if (!consent.checked) problems.push("Нужно согласие с политикой конфиденциальности");
    if (problems.length) { err.textContent = problems[0]; return; }
    btn.disabled = true;
    btn.textContent = "Создаём ключи шифрования…";
    try {
      await store.register(name.input.value, user.input.value, pass.input.value);
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
