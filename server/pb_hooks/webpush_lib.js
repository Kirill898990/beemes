// Уведомления в браузер и на iPhone (Web Push), когда beemes закрыт.
//
// iPhone получает уведомления от сайта, добавленного на экран «Домой» (iOS 16.4+). Сервер отправляет пустой
// «толчок» в службу уведомлений (Apple, Google, Mozilla) — без текста. Проснувшись, страница-помощник beemes
// (sw.js) сама забирает у сервера, что пришло, и расшифровывает сообщение ключом, который хранится только
// на устройстве. Так ни Apple, ни сервер текста не видят.
//
// Толчок подписывается ключом сервера (VAPID, ES256). В PocketBase нет такой подписи, поэтому — openssl,
// как и для Firebase. Ключ создаётся сам при первой отправке: pb_data/vapid.pem.

// Куда можно слать: только службы уведомлений браузеров (иначе через нас можно было бы стучаться куда угодно).
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)(:443)?\//i

function allowedEndpoint(url) {
  const u = String(url || "")
  if (u.length > 1000) return false
  if (PUSH_HOSTS.test(u)) return true
  // Для проверок на своём компьютере: WEBPUSH_TEST=http://127.0.0.1:ПОРТ/ — адрес поддельной службы.
  const test = $os.getenv("WEBPUSH_TEST") || ""
  return /^http:\/\/127\.0\.0\.1:\d+\/$/.test(test) && u.startsWith(test)
}

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function unb64(text) {
  const s = String(text).replace(/[^A-Za-z0-9+/]/g, "")
  const out = []
  for (let i = 0; i < s.length; i += 4) {
    const n = (ABC.indexOf(s[i]) << 18) | (ABC.indexOf(s[i + 1]) << 12) | ((i + 2 < s.length ? ABC.indexOf(s[i + 2]) : 0) << 6) | (i + 3 < s.length ? ABC.indexOf(s[i + 3]) : 0)
    out.push((n >> 16) & 255)
    if (i + 2 < s.length) out.push((n >> 8) & 255)
    if (i + 3 < s.length) out.push(n & 255)
  }
  return out
}
function b64url(bytes) {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += ABC[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += ABC[n & 63]
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_")
}
const utf8 = (text) => unescape(encodeURIComponent(text)).split("").map((c) => c.charCodeAt(0))

/** Подпись ECDSA в DER → 64 байта r||s (так требует JWT). */
function derToRaw(der) {
  let i = 2
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f)
  const part = () => {
    if (der[i] !== 2) throw new Error("bad signature")
    const len = der[i + 1]
    let v = der.slice(i + 2, i + 2 + len)
    i += 2 + len
    while (v.length > 32 && v[0] === 0) v = v.slice(1)
    while (v.length < 32) v = [0].concat(v)
    return v
  }
  return part().concat(part())
}

function sh(cmd) {
  return toString($os.cmd("sh", "-c", cmd).output()).trim()
}

/** Открытый ключ сервера (для подписки в браузере). Создаёт пару ключей, если её ещё нет. */
function publicKey(app) {
  const cached = app.store().get("vapid_pub")
  if (cached) return cached
  const file = app.dataDir() + "/vapid.pem"
  let exists = true
  try { $os.stat(file) } catch (_) { exists = false }
  if (!exists) sh(`umask 077; openssl ecparam -name prime256v1 -genkey -noout -out '${file}'`)
  const key = b64url(unb64(sh(`openssl ec -in '${file}' -pubout -outform DER 2>/dev/null | tail -c 65 | openssl base64 -A`)))
  if (key.length < 80) throw new Error("VAPID: не получилось прочитать ключ")
  app.store().set("vapid_pub", key)
  return key
}

/** Пропуск для службы уведомлений (JWT ES256), живёт 12 часов. */
function vapidJwt(app, audience) {
  const cacheKey = "vapid_jwt:" + audience
  const cached = app.store().get(cacheKey)
  if (cached && cached.exp > Date.now() + 60 * 60 * 1000) return cached.token
  publicKey(app)
  const now = Math.floor(Date.now() / 1000)
  const site = String($os.getenv("SITE_URL") || "").replace(/\/+$/, "")
  const unsigned = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" }))) + "." +
    b64url(utf8(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: /^https:\/\//.test(site) ? site : "mailto:admin@beemes.ru" })))
  const dir = app.dataDir()
  const inFile = dir + "/vapid_jwt.txt"
  $os.writeFile(inFile, unsigned, 0o600)
  const sig = derToRaw(unb64(sh(`openssl dgst -sha256 -sign '${dir}/vapid.pem' '${inFile}' | openssl base64 -A`)))
  const token = unsigned + "." + b64url(sig)
  app.store().set(cacheKey, { token, exp: Date.now() + 12 * 3600 * 1000 })
  return token
}

// ---------- Очередь: что показать, когда устройство проснётся ----------

const QUEUE_MAX = 20
const QUEUE_AGE = 60 * 60 * 1000

function readQueue(app, deviceId) {
  try { return JSON.parse(app.store().get("wpq:" + deviceId) || "[]") } catch (_) { return [] }
}
function enqueue(app, deviceId, data, ttl) {
  const now = Date.now()
  const list = readQueue(app, deviceId).filter((i) => i.exp > now)
  list.push({ data, exp: now + Math.min((ttl || 3600) * 1000, QUEUE_AGE) })
  app.store().set("wpq:" + deviceId, JSON.stringify(list.slice(-QUEUE_MAX)))
}
/** Забрать всё, что накопилось для устройства (и очистить). */
function takeQueue(app, deviceId) {
  const now = Date.now()
  const list = readQueue(app, deviceId).filter((i) => i.exp > now).map((i) => i.data)
  app.store().remove("wpq:" + deviceId)
  return list
}

/** Страница beemes на этом устройстве сейчас на экране — она сама покажет уведомление. */
function pageOpen(app, userId, presenceId) {
  if (!presenceId) return false
  const stored = app.store().get("presence:" + userId) || {}
  const d = stored[presenceId]
  return !!d && Number(d.u) > Date.now()
}

/**
 * Разбудить браузеры человека. devices — его записи devices с platform = "web".
 * → сколько браузеров служба уведомлений приняла.
 */
function sendWebPush(app, userId, devices, data, urgent, ttl, report) {
  const r = report || {}
  r.webErrors = r.webErrors || []
  // Конец звонка браузеру не шлём: iPhone обязан что-то показать на каждый толчок.
  if (data.type === "call_end") return 0
  let sent = 0
  devices.forEach((d) => {
    if (data.type !== "test" && pageOpen(app, userId, d.getString("presence"))) return
    const endpoint = d.getString("token")
    if (!allowedEndpoint(endpoint)) { app.delete(d); return }
    try {
      const audience = /^(https?:\/\/[^/]+)/.exec(endpoint)[1]
      enqueue(app, d.id, data, ttl)
      const res = $http.send({
        url: endpoint,
        method: "POST",
        headers: {
          TTL: String(ttl || 86400),
          Urgency: urgent ? "high" : "normal",
          Authorization: `vapid t=${vapidJwt(app, audience)}, k=${publicKey(app)}`,
        },
        body: "",
        timeout: 10,
      })
      if (res.statusCode >= 200 && res.statusCode < 300) sent++
      else {
        const body = toString(res.body).slice(0, 200)
        r.webErrors.push(res.statusCode + ": " + body)
        app.logger().warn("Web Push: не доставлено", "status", res.statusCode, "body", body)
        // Подписка больше не действует (удалили с экрана «Домой», запретили уведомления).
        if (res.statusCode === 404 || res.statusCode === 410) app.delete(d)
        else if (res.statusCode === 401 || res.statusCode === 403) app.store().remove("vapid_jwt:" + audience)
      }
    } catch (err) {
      app.logger().warn("Web Push: не отправилось", "error", String(err))
      r.webErrors.push("network: " + String(err).slice(0, 160))
    }
  })
  return sent
}

module.exports = { allowedEndpoint, publicKey, sendWebPush, takeQueue, derToRaw, unb64, b64url }
