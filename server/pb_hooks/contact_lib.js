// Почта и телефон: коды для регистрации и входа, отправка SMS (SMS.ru). См. contacts.pb.js.

const S = () => require(`${__hooks}/security_lib.js`)

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120
const normEmail = (v) => String(v || "").trim().toLowerCase()

/** Номер в виде +7XXXXXXXXXX (Россия и Казахстан) или "" — неверный. Другие страны не принимаем: SMS туда дорогие. */
function normPhone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "").replace(/^\+/, "")
  if (/^8\d{10}$/.test(d)) d = "7" + d.slice(1)
  if (/^9\d{9}$/.test(d)) d = "7" + d
  return /^7\d{10}$/.test(d) ? "+" + d : ""
}

/** Что ввёл человек: { kind: "email" | "phone", value } или null. */
function parseContact(raw) {
  const s = String(raw || "").trim()
  if (s.indexOf("@") > 0) { const v = normEmail(s); return isEmail(v) ? { kind: "email", value: v } : null }
  const p = normPhone(s)
  return p ? { kind: "phone", value: p } : null
}

const maskPhone = (p) => p.slice(0, 2) + " ••• •••-••-" + p.slice(-2)
const mask = (c) => (c.kind === "email" ? S().maskEmail(c.value) : maskPhone(c.value))

function settings(app) {
  try { return app.findFirstRecordByFilter("bm_settings", "id != ''") } catch (_) { return null }
}
const smsConfigured = (app) => { const s = settings(app); return !!(s && s.getString("smsApiKey")) }
const mailConfigured = (app) => !!app.settings().smtp.enabled

/** Счётчик в памяти сервера: не больше max за окно ms. Превысили — ошибка с текстом msg. */
function limit(app, key, max, ms, msg) {
  const now = Date.now()
  let c = app.store().get(key)
  if (!c || now - c.t > ms) c = { t: now, n: 0 }
  if (c.n >= max) throw new TooManyRequestsError(msg)
  c.n++
  app.store().set(key, c)
}

/** SMS через SMS.ru. Ключ — в панели: коллекция bm_settings, поле smsApiKey. */
function sendSms(app, phone, text) {
  const s = settings(app)
  const key = s && s.getString("smsApiKey")
  if (!key) throw new BadRequestError("SMS пока не подключены. Используйте почту.")
  const day = new Date().toISOString().slice(0, 10)
  limit(app, "sms_all:" + day, (s.getInt("smsDailyLimit") || 300), 86400000, "Сегодня SMS больше не отправить — попробуйте завтра или войдите по почте")
  const url = (s.getString("smsUrl") || "https://sms.ru/sms/send") +
    "?api_id=" + encodeURIComponent(key) + "&to=" + encodeURIComponent(phone.slice(1)) + "&msg=" + encodeURIComponent(text) + "&json=1"
  let res = null
  try { res = $http.send({ url, method: "GET", timeout: 15 }) } catch (err) {
    app.logger().warn("sms failed", "error", String(err))
    throw new BadRequestError("Не получилось отправить SMS — попробуйте ещё раз")
  }
  const j = res.json || {}
  const one = (j.sms || {})[phone.slice(1)] || {}
  if (res.statusCode !== 200 || j.status !== "OK" || one.status !== "OK") {
    app.logger().warn("sms failed", "status", res.statusCode, "body", toString(res.body).slice(0, 300))
    throw new BadRequestError("Не получилось отправить SMS на этот номер")
  }
}

/**
 * Отправить код на почту или телефон. key — где хранить (signup:…, login:…, phone:…).
 * Не чаще раза в минуту на один адрес, не больше 5 SMS в сутки на номер, 10 SMS в час с одного IP.
 */
function sendCode(app, e, key, c, title, note, extra) {
  const prev = app.store().get(key)
  if (prev && Date.now() - prev.sent < 60000) throw new TooManyRequestsError("Код уже отправлен — подождите минуту")
  const code = S().randomCode()
  if (c.kind === "email") {
    limit(app, "mail_ip:" + e.realIP(), 20, 3600000, "Слишком много писем — попробуйте через час")
    S().sendMail(app, c.value, title + ": " + code, S().codeMail(title, code, note))
  } else {
    limit(app, "sms_ip:" + e.realIP(), 10, 3600000, "Слишком много SMS — попробуйте через час")
    limit(app, "sms_to:" + c.value, 5, 86400000, "На этот номер сегодня уже отправлено много кодов — попробуйте завтра")
    sendSms(app, c.value, "beemes: код " + code + ". Никому его не сообщайте.")
  }
  app.store().set(key, Object.assign({ hash: S().hash(code), exp: Date.now() + 600000, tries: 0, sent: Date.now() }, extra || {}))
}

/** Пропуск после кода при входе по почте/телефону: дальше нужен только пароль (2FA уже пройдена кодом). */
function issueTicket(app, userId) {
  const t = S().randomId(32)
  app.store().set("ticket:" + S().hash(t), { user: userId, exp: Date.now() + 600000 })
  return t
}
function useTicket(app, userId, ticket) {
  if (!ticket) return false
  const k = "ticket:" + S().hash(ticket)
  const t = app.store().get(k)
  if (!t || t.exp < Date.now() || t.user !== userId) return false
  app.store().remove(k)
  return true
}

/** Чей это адрес: подтверждённая почта или номер. */
function findByContact(app, c) {
  try {
    return c.kind === "email"
      ? app.findFirstRecordByFilter("users", "email = {:v} && verified = true", { v: c.value })
      : app.findFirstRecordByFilter("users", "phone = {:v}", { v: c.value })
  } catch (_) { return null }
}

function contactTaken(app, c, exceptUser) {
  const field = c.kind === "email" ? "email" : "phone"
  return app.countRecords("users", $dbx.exp(field + " = {:v} AND id != {:me}", { v: c.value, me: exceptUser || "" })) > 0
}

module.exports = { parseContact, normPhone, mask, maskPhone, smsConfigured, mailConfigured, sendCode, sendSms, issueTicket, useTicket, findByContact, contactTaken, limit }
