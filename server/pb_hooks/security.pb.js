/// <reference path="../pb_data/types.d.ts" />
// Устройства (сеансы), вход по QR-коду, почта и 2FA. Общее — в security_lib.js.

// ---------- Сеансы ----------

// Каждый вход (пароль, QR) — новый сеанс: приложение получает его id и секрет в ответе (meta.session).
onRecordAuthRequest((e) => {
  if (["password", "otp", "qr"].indexOf(e.authMethod) >= 0) {
    const S = require(`${__hooks}/security_lib.js`)
    const s = S.createSession(e.app, e, e.record.id, e.authMethod)
    e.meta = Object.assign({}, e.meta || {}, { session: s })
  }
  e.next()
}, "users")

// Продлить вход: секрет сеанса → новый пропуск. Закрытый сеанс (или неактивный полгода) — нет.
routerAdd("POST", "/api/bm/session/renew", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const { iso } = require(`${__hooks}/lib.js`)
  const b = e.requestInfo().body || {}
  let s = null
  try { s = e.app.findRecordById("sessions", String(b.id || "")) } catch (_) {}
  const stale = s && Date.now() - new Date(s.getString("lastActive").replace(" ", "T")).getTime() > 180 * 86400000
  if (!s || s.getBool("revoked") || stale || s.getString("secretHash") !== S.hash(b.secret)) {
    throw new UnauthorizedError("Сеанс завершён — войдите заново")
  }
  const user = e.app.findRecordById("users", s.getString("user"))
  s.set("lastActive", iso(Date.now()))
  s.set("ip", e.realIP())
  e.app.save(s)
  return $apis.recordAuthResponse(e, user, "renew", { session: { id: s.id } })
})

// Вошли раньше, чем появились сеансы, — заводим сеанс для этого устройства.
routerAdd("POST", "/api/bm/session/create", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const { iso } = require(`${__hooks}/lib.js`)
  const recent = e.app.countRecords("sessions", $dbx.exp("user = {:u} AND created > {:t}", { u: e.auth.id, t: iso(Date.now() - 60000) }))
  if (recent >= 5) throw new TooManyRequestsError("Слишком часто")
  return e.json(200, S.createSession(e.app, e, e.auth.id, "app"))
}, $apis.requireAuth("users"))

// Мои устройства: откуда и когда входили.
routerAdd("GET", "/api/bm/sessions", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const cur = S.currentSession(e)
  const list = e.app.findRecordsByFilter("sessions", "user = {:u} && revoked = false", "-lastActive", 100, 0, { u: e.auth.id })
  return e.json(200, {
    items: list.map((s) => ({
      id: s.id, name: s.getString("name"), platform: s.getString("platform"), ip: s.getString("ip"), how: s.getString("how"),
      created: s.getString("created"), lastActive: s.getString("lastActive"), current: s.id === cur,
    })),
  })
}, $apis.requireAuth("users"))

// Завершить один сеанс (свой — это просто «выйти»).
routerAdd("POST", "/api/bm/sessions/{id}/end", (e) => {
  let s = null
  try { s = e.app.findRecordById("sessions", e.request.pathValue("id")) } catch (_) {}
  if (!s || s.getString("user") !== e.auth.id) throw new NotFoundError("Сеанс не найден")
  const S = require(`${__hooks}/security_lib.js`)
  if (s.id === S.currentSession(e)) { s.set("revoked", true); e.app.save(s); return e.json(200, { ended: 1 }) }
  S.endSessions(e, [s])
  return e.json(200, { ended: 1 })
}, $apis.requireAuth("users"))

// Завершить все, кроме этого устройства.
routerAdd("POST", "/api/bm/sessions/end-others", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const cur = S.currentSession(e)
  const others = e.app.findRecordsByFilter("sessions", "user = {:u} && revoked = false && id != {:c}", "", 0, 0, { u: e.auth.id, c: cur })
  S.endSessions(e, others)
  return e.json(200, { ended: others.length })
}, $apis.requireAuth("users"))

// ---------- Вход по QR-коду ----------
// Новое устройство показывает QR: id входа и свой временный открытый ключ. Телефон, где вы уже вошли, сканирует,
// подтверждает и шифрует ключ переписки для этого временного ключа (из QR — сервер подменить его не может).
// Новое устройство забирает пропуск и зашифрованный ключ. Живёт 3 минуты.

routerAdd("POST", "/api/bm/qr/start", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const b = e.requestInfo().body || {}
  if (!/^[A-Za-z0-9+/]{43}=$/.test(String(b.pub || ""))) throw new BadRequestError("Неверный ключ")
  const ipKey = "qr_ip:" + e.realIP()
  const n = (e.app.store().get(ipKey) || { n: 0, t: Date.now() })
  if (Date.now() - n.t > 60000) { n.n = 0; n.t = Date.now() }
  if (++n.n > 20) throw new TooManyRequestsError("Слишком часто")
  e.app.store().set(ipKey, n)
  const id = S.randomId(20)
  const secret = S.randomId(32)
  const d = S.deviceOf(e)
  e.app.store().set("qr:" + id, JSON.stringify({ pub: b.pub, name: d.name, platform: d.platform, ip: e.realIP(), secretHash: S.hash(secret), status: "pending", exp: Date.now() + 180000 }))
  return e.json(200, { id, secret, expiresIn: 180 })
})

// Телефон: что за устройство просит войти.
routerAdd("GET", "/api/bm/qr/{id}", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const q = S.loadQr(e, e.request.pathValue("id"))
  return e.json(200, { name: q.name, platform: q.platform, ip: q.ip, status: q.status })
}, $apis.requireAuth("users"))

// Телефон: подтвердить вход и передать зашифрованный ключ переписки.
routerAdd("POST", "/api/bm/qr/{id}/approve", (e) => {
  const id = e.request.pathValue("id")
  const S = require(`${__hooks}/security_lib.js`)
  const q = S.loadQr(e, id)
  if (q.status !== "pending") throw new BadRequestError("Этот QR-код уже использован")
  const b = e.requestInfo().body || {}
  if (!/^[A-Za-z0-9+/]{43}=$/.test(String(b.e2pub || "")) || !/^[A-Za-z0-9+/=]{40,200}$/.test(String(b.body || "")) || !/^[A-Za-z0-9+/=]{16,32}$/.test(String(b.nonce || ""))) {
    throw new BadRequestError("Ключ должен быть зашифрован")
  }
  q.status = "approved"
  q.user = e.auth.id
  q.payload = { e2pub: b.e2pub, body: b.body, nonce: b.nonce }
  e.app.store().set("qr:" + id, JSON.stringify(q))
  return e.json(200, { ok: true })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/qr/{id}/decline", (e) => {
  const id = e.request.pathValue("id")
  const S = require(`${__hooks}/security_lib.js`)
  const q = S.loadQr(e, id)
  q.status = "declined"
  e.app.store().set("qr:" + id, JSON.stringify(q))
  return e.json(200, { ok: true })
}, $apis.requireAuth("users"))

// Новое устройство: ждём подтверждения; подтвердили — пропуск, сеанс и зашифрованный ключ.
routerAdd("POST", "/api/bm/qr/{id}/poll", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const id = e.request.pathValue("id")
  const q = S.loadQr(e, id)
  if (q.secretHash !== S.hash((e.requestInfo().body || {}).secret)) throw new NotFoundError("QR-код устарел — обновите его на устройстве")
  if (q.status !== "approved") return e.json(200, { status: q.status })
  e.app.store().remove("qr:" + id)
  const user = e.app.findRecordById("users", q.user)
  return $apis.recordAuthResponse(e, user, "qr", { qr: q.payload })
})

// ---------- Почта и 2FA ----------

// Привязать почту: шлём код, человек вводит его — почта подтверждена.
routerAdd("POST", "/api/bm/email/start", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const email = String((e.requestInfo().body || {}).email || "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new BadRequestError("Проверьте адрес почты")
  if (e.app.countRecords("users", $dbx.exp("email = {:m} AND id != {:me}", { m: email, me: e.auth.id })) > 0) throw new BadRequestError("Эта почта уже привязана к другому аккаунту")
  const key = "email:" + e.auth.id
  const prev = e.app.store().get(key)
  if (prev && Date.now() - prev.sent < 60000) throw new TooManyRequestsError("Письмо уже отправлено — подождите минуту")
  const code = S.randomCode()
  S.sendMail(e.app, email, "Код для beemes: " + code, S.codeMail("Подтвердите почту", code, "Введите этот код в beemes, чтобы привязать почту. Код действует 10 минут."))
  e.app.store().set(key, { hash: S.hash(code), exp: Date.now() + 600000, tries: 0, sent: Date.now(), email })
  return e.json(200, { sent: true, to: S.maskEmail(email) })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/email/confirm", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const key = "email:" + e.auth.id
  const st = e.app.store().get(key)
  const email = st && st.email
  if (!email || !S.checkCode(e.app, key, (e.requestInfo().body || {}).code)) throw new BadRequestError("Неверный или устаревший код")
  const user = e.app.findRecordById("users", e.auth.id)
  user.set("email", email)
  user.set("verified", true)
  user.set("emailVisibility", false)
  e.app.save(user)
  // Смена почты обнуляет пропуска входа — этому устройству сразу выдаём новый (остальные продлят секретом сеанса).
  return $apis.recordAuthResponse(e, user, "renew", { email })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/bm/email/remove", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const user = S.requirePassword(e)
  user.set("email", "")
  user.set("verified", false)
  user.set("twoFactor", false)
  e.app.save(user)
  return $apis.recordAuthResponse(e, user, "renew", { ok: true })
}, $apis.requireAuth("users"))

// Включить/выключить 2FA (нужна подтверждённая почта и пароль).
routerAdd("POST", "/api/bm/2fa", (e) => {
  const S = require(`${__hooks}/security_lib.js`)
  const user = S.requirePassword(e)
  const on = !!(e.requestInfo().body || {}).enabled
  if (on && (!user.getString("email") || !user.getBool("verified"))) throw new BadRequestError("Сначала привяжите и подтвердите почту")
  user.set("twoFactor", on)
  e.app.save(user)
  return e.json(200, { twoFactor: on })
}, $apis.requireAuth("users"))

// Вход по паролю с 2FA: верный пароль → письмо с кодом; вход — только с кодом.
// (Ограничение «10 неверных попыток» из main.pb.js считает и неверные коды.)
onRecordAuthWithPasswordRequest((e) => {
  if (!e.record || !e.record.getBool("twoFactor") || !e.record.validatePassword(e.password)) return e.next()
  // Вошли кодом с почты или телефона (contacts.pb.js) — второй код не нужен.
  if (require(`${__hooks}/contact_lib.js`).useTicket(e.app, e.record.id, (e.requestInfo().body || {}).ticket)) return e.next()
  const S = require(`${__hooks}/security_lib.js`)
  const key = "2fa:" + e.record.id
  const code = String((e.requestInfo().body || {}).code || "").trim()
  const email = e.record.getString("email")
  if (code) {
    if (!S.checkCode(e.app, key, code)) throw new BadRequestError("Неверный код из письма", { code: new ValidationError("2fa_invalid", "Неверный код из письма") })
    return e.next()
  }
  const prev = e.app.store().get(key)
  if (!prev || prev.exp < Date.now() || Date.now() - prev.sent > 60000) {
    const c = S.randomCode()
    S.sendMail(e.app, email, "Код для входа в beemes: " + c, S.codeMail("Вход в beemes", c, "Кто-то (надеемся, вы) входит в ваш аккаунт. Введите код, чтобы продолжить. Код действует 10 минут."))
    e.app.store().set(key, { hash: S.hash(c), exp: Date.now() + 600000, tries: 0, sent: Date.now() })
  }
  throw new BadRequestError("Введите код из письма", { twoFactor: new ValidationError("2fa_required", S.maskEmail(email)) })
}, "users")
