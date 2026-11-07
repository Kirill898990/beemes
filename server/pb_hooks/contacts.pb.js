/// <reference path="../pb_data/types.d.ts" />
// Регистрация и вход по почте и номеру телефона. Общее — в contact_lib.js.
//
// Регистрация: «Почта или телефон» → код → аккаунт создаётся с подтверждённой почтой или номером.
// Вход: почта или телефон → код → сервер называет @имя и выдаёт пропуск на 10 минут → пароль.
// Пароль нужен всегда: им зашифрован ключ переписки (на сервере его нет).

// Что сейчас доступно (приложение показывает только работающие способы).
routerAdd("GET", "/api/bm/auth-options", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  return e.json(200, { email: C.mailConfigured(e.app), phone: C.smsConfigured(e.app) })
})

// Код для регистрации.
routerAdd("POST", "/api/bm/signup/code", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  const c = C.parseContact((e.requestInfo().body || {}).contact)
  if (!c) throw new BadRequestError("Впишите почту или номер телефона (+7…)")
  if (C.contactTaken(e.app, c)) throw new BadRequestError(c.kind === "email" ? "Эта почта уже привязана к другому аккаунту — войдите по ней" : "Этот номер уже привязан к другому аккаунту — войдите по нему")
  C.sendCode(e.app, e, "signup:" + c.value, c, "Код для регистрации в beemes", "Введите его в beemes, чтобы закончить регистрацию. Код действует 10 минут.")
  return e.json(200, { sent: true, kind: c.kind, to: C.mask(c) })
})

// Регистрация с почтой или телефоном: код проверяется здесь. Почту без кода поставить нельзя.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const C = require(`${__hooks}/contact_lib.js`)
  const S = require(`${__hooks}/security_lib.js`)
  const b = e.requestInfo().body || {}
  e.record.set("email", "")
  e.record.set("verified", false)
  e.record.set("phone", "")
  let verifyEmail = false
  if (b.contact) {
    const c = C.parseContact(b.contact)
    if (!c) throw new BadRequestError("Неверная почта или номер телефона")
    if (!S.checkCode(e.app, "signup:" + c.value, b.contactCode)) {
      throw new BadRequestError("Неверный или устаревший код", { contactCode: new ValidationError("code_invalid", "Неверный или устаревший код") })
    }
    if (C.contactTaken(e.app, c)) throw new BadRequestError("Эта почта или номер уже привязаны к другому аккаунту")
    if (c.kind === "email") { e.record.set("email", c.value); e.record.set("emailVisibility", false); verifyEmail = true }
    else e.record.set("phone", c.value)
  }
  e.next()
  // «Почта подтверждена» PocketBase не даёт поставить в самом запросе регистрации — ставим сразу после.
  if (verifyEmail) {
    const u = e.app.findRecordById("users", e.record.id)
    u.set("verified", true)
    e.app.save(u)
  }
}, "users")

// Вход: код на почту или телефон. Ответ одинаковый, есть такой аккаунт или нет (не подсказываем чужие адреса).
routerAdd("POST", "/api/bm/login/code", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  const c = C.parseContact((e.requestInfo().body || {}).contact)
  if (!c) throw new BadRequestError("Впишите почту или номер телефона (+7…)")
  if (c.kind === "phone" && !C.smsConfigured(e.app)) throw new BadRequestError("Вход по SMS пока не подключён — войдите по @имени или почте")
  C.limit(e.app, "login_code_ip:" + e.realIP(), 20, 3600000, "Слишком много попыток — попробуйте через час")
  const user = C.findByContact(e.app, c)
  if (user) C.sendCode(e.app, e, "login:" + c.value, c, "Код для входа в beemes", "Кто-то (надеемся, вы) входит в beemes. Код действует 10 минут. Если это не вы — просто не сообщайте его никому.")
  return e.json(200, { sent: true, kind: c.kind, to: C.mask(c) })
})

// Код верный → @имя и пропуск на 10 минут; дальше приложение входит паролем (+ пропуск вместо кода 2FA).
routerAdd("POST", "/api/bm/login/verify", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  const S = require(`${__hooks}/security_lib.js`)
  const b = e.requestInfo().body || {}
  const c = C.parseContact(b.contact)
  if (!c || !S.checkCode(e.app, "login:" + c.value, b.code)) throw new BadRequestError("Неверный или устаревший код")
  const user = C.findByContact(e.app, c)
  if (!user) throw new BadRequestError("Неверный или устаревший код")
  return e.json(200, { username: user.getString("username"), name: user.getString("name"), ticket: C.issueTicket(e.app, user.id) })
})

// ---------- Телефон в настройках ----------

routerAdd("GET", "/api/bm/contact", (e) => {
  const u = e.app.findRecordById("users", e.auth.id)
  return e.json(200, { email: u.getString("email"), verified: u.getBool("verified"), phone: u.getString("phone") })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/phone/start", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  const p = C.normPhone((e.requestInfo().body || {}).phone)
  if (!p) throw new BadRequestError("Впишите номер в виде +7 999 123-45-67")
  const c = { kind: "phone", value: p }
  if (C.contactTaken(e.app, c, e.auth.id)) throw new BadRequestError("Этот номер уже привязан к другому аккаунту")
  C.sendCode(e.app, e, "phone:" + e.auth.id, c, "", "", { phone: p })
  return e.json(200, { sent: true, to: C.maskPhone(p) })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/phone/confirm", (e) => {
  const C = require(`${__hooks}/contact_lib.js`)
  const S = require(`${__hooks}/security_lib.js`)
  const key = "phone:" + e.auth.id
  const st = e.app.store().get(key)
  const phone = st && st.phone
  if (!phone || !S.checkCode(e.app, key, (e.requestInfo().body || {}).code)) throw new BadRequestError("Неверный или устаревший код")
  if (C.contactTaken(e.app, { kind: "phone", value: phone }, e.auth.id)) throw new BadRequestError("Этот номер уже привязан к другому аккаунту")
  const u = e.app.findRecordById("users", e.auth.id)
  u.set("phone", phone)
  e.app.save(u)
  return e.json(200, { phone })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/phone/remove", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const u = S.requirePassword(e)
  u.set("phone", "")
  e.app.save(u)
  return e.json(200, { phone: "" })
}, $apis.requireAuth("users"))
