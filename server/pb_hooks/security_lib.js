// Устройства, вход по QR-коду, коды из писем (см. security.pb.js).

const DIGITS = "0123456789"
const ALNUM = "abcdefghijkmnpqrstuvwxyz23456789"

const hash = (s) => $security.sha256(String(s || ""))
const randomCode = () => $security.randomStringWithAlphabet(6, DIGITS)
const randomId = (n) => $security.randomStringWithAlphabet(n || 24, ALNUM)

/** Какое устройство: приложение присылает X-BM-Device «платформа|название», браузер — только User-Agent. */
function deviceOf(e) {
  // Заголовки — через requestInfo: так они есть и в обработчиках маршрутов, и в событиях входа.
  const headers = (e.requestInfo && e.requestInfo().headers) || {}
  const header = String(headers["x_bm_device"] || "")
  const ua = String(headers["user_agent"] || "")
  const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n)
  if (header.indexOf("|") > 0) {
    // название в заголовке закодировано (encodeURIComponent): в заголовках нельзя кириллицу
    let [platform, name] = header.split("|")
    try { name = decodeURIComponent(name) } catch (_) { /* как есть */ }
    return { platform: clean(platform, 20).toLowerCase(), name: clean(name, 120) || "Устройство", ua }
  }
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер"
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : ""
  const platform = /iPhone|iPad/.test(ua) ? "iphone" : /Android/.test(ua) ? "android" : "web"
  return { platform, name: browser + (os ? " на " + os : ""), ua }
}

/** Новый сеанс → {id, secret}. Секрет видит только устройство, на сервере — хэш. */
function createSession(app, e, userId, how) {
  const d = deviceOf(e)
  const { iso } = require(`${__hooks}/lib.js`)
  const s = new Record(app.findCollectionByNameOrId("sessions"))
  const secret = randomId(40)
  s.set("user", userId)
  s.set("name", d.name)
  s.set("platform", d.platform)
  let ip = ""
  try { ip = e.realIP() } catch (_) { ip = String(((e.requestInfo && e.requestInfo().headers) || {})["x_real_ip"] || "") }
  s.set("ip", ip)
  s.set("how", how)
  s.set("secretHash", hash(secret))
  s.set("lastActive", iso(Date.now()))
  app.save(s)
  return { id: s.id, secret }
}

/** Отправить письмо. Почта настраивается в панели администратора (Settings → Mail settings). */
function sendMail(app, to, subject, html) {
  const meta = app.settings().meta
  const msg = new MailerMessage({
    from: { address: meta.senderAddress || "noreply@beemes.ru", name: meta.senderName || "beemes" },
    to: [{ address: to }],
    subject,
    html,
  })
  try {
    app.newMailClient().send(msg)
  } catch (err) {
    app.logger().warn("mail failed", "error", String(err))
    throw new BadRequestError("Не получилось отправить письмо: почта на сервере не настроена. Сообщите администратору.")
  }
}

const codeMail = (title, code, note) =>
  `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border-radius:20px;background:#FFF8EA;color:#1B1626">` +
  `<h2 style="margin:0 0 12px">🐝 ${title}</h2><p style="font-size:34px;font-weight:800;letter-spacing:6px;margin:12px 0;color:#E89A00">${code}</p>` +
  `<p style="color:#5F5870">${note}</p><p style="color:#A59D8C;font-size:12px">Если это были не вы — просто не сообщайте код никому.</p></div>`

/** Проверить код из письма (хранится хэш; 5 попыток, 10 минут). → true / false. */
function checkCode(app, key, code) {
  const st = app.store().get(key)
  if (!st || st.exp < Date.now()) { app.store().remove(key); return false }
  if (st.hash === hash(String(code || "").trim())) { app.store().remove(key); return true }
  st.tries = (st.tries || 0) + 1
  if (st.tries >= 5) app.store().remove(key); else app.store().set(key, st)
  return false
}

const maskEmail = (email) => String(email || "").replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + "•".repeat(Math.min(6, b.length)) + c)

const currentSession = (e) => String((e.requestInfo().headers || {})["x_bm_session"] || "")

/** Закрыть сеансы и сменить ключ входа: старые пропуска умирают, живые устройства продлят вход секретом. */
function endSessions(e, list) {
  const user = e.app.findRecordById("users", e.auth.id)
  list.forEach((s) => { s.set("revoked", true); e.app.save(s) })
  user.refreshTokenKey()
  e.app.save(user)
}

function loadQr(e, id) {
  let q = null
  try { q = JSON.parse(e.app.store().get("qr:" + id) || "null") } catch (_) {}
  if (!q || q.exp < Date.now()) { e.app.store().remove("qr:" + id); throw new NotFoundError("QR-код устарел — обновите его на устройстве") }
  return q
}

/** Пароль ещё раз — для важных изменений (приложение присылает его так же, как при входе). */
function requirePassword(e) {
  const user = e.app.findRecordById("users", e.auth.id)
  if (!user.validatePassword(String((e.requestInfo().body || {}).password || ""))) throw new BadRequestError("Неверный пароль")
  return user
}

module.exports = { currentSession, endSessions, loadQr, requirePassword, hash, randomCode, randomId, deviceOf, createSession, sendMail, codeMail, checkCode, maskEmail }
