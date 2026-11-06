// Push-уведомления через Firebase Cloud Messaging (FCM HTTP v1).
//
// Ключ сервисного аккаунта Firebase администратор вставляет в веб-панели: Collections → bm_settings → firebaseKey.
// Для входа в Firebase нужен JWT, подписанный этим ключом (RS256). В PocketBase нет RSA-подписи,
// поэтому подписываем стандартной программой openssl (она есть на любом сервере Ubuntu).
//
// Содержимое сообщений в уведомлении зашифровано так же, как в чате: Google его прочитать не может —
// телефон получает уведомление и сам расшифровывает текст.

function settings(app) {
  try {
    return app.findFirstRecordByFilter("bm_settings", "id != ''")
  } catch (_) {
    return null
  }
}

function b64url(text) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const bytes = []
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c < 128) bytes.push(c)
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63))
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63))
  }
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += abc[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += abc[n & 63]
  }
  return out
}

/** Ключ доступа Google (живёт час, храним в памяти сервера). */
function accessToken(app, key, tokenUrl) {
  const cached = app.store().get("fcm_access")
  if (cached && cached.exp > Date.now() + 60 * 1000 && cached.email === key.client_email) return cached.token
  const dir = app.dataDir()
  const keyFile = dir + "/fcm_key.pem"
  const inFile = dir + "/fcm_jwt.txt"
  $os.writeFile(keyFile, key.private_key, 0o600)
  const now = Math.floor(Date.now() / 1000)
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  }))
  $os.writeFile(inFile, unsigned, 0o600)
  const sig = toString($os.cmd("sh", "-c", `openssl dgst -sha256 -sign '${keyFile}' '${inFile}' | openssl base64 -A`).output())
    .trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const res = $http.send({
    url: tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + unsigned + "." + sig,
    timeout: 15,
  })
  if (res.statusCode !== 200 || !res.json || !res.json.access_token) {
    app.logger().warn("Firebase: не получилось войти", "status", res.statusCode, "body", toString(res.body).slice(0, 300))
    return ""
  }
  app.store().set("fcm_access", { token: res.json.access_token, exp: Date.now() + (res.json.expires_in || 3600) * 1000, email: key.client_email })
  return res.json.access_token
}

/**
 * Отправить уведомление на все телефоны человека. data — только строки (так требует FCM).
 * urgent — для звонков: доставить сразу, даже если телефон спит. ttl — сколько секунд уведомление ещё актуально.
 * → сколько телефонов получили уведомление.
 */
function pushToUser(app, userId, data, urgent, ttl) {
  const s = settings(app)
  if (!s) return 0
  let key = null
  try { key = JSON.parse(s.getString("firebaseKey") || "null") } catch (_) {}
  if (!key || !key.private_key || !key.client_email || !key.project_id) return 0
  const devices = app.findRecordsByFilter("devices", "user = {:u}", "-updated", 10, 0, { u: userId })
  if (!devices.length) return 0
  const tokenUrl = s.getString("tokenUrl") || key.token_uri || "https://oauth2.googleapis.com/token"
  let access = ""
  try { access = accessToken(app, key, tokenUrl) } catch (err) { app.logger().warn("Firebase: ошибка входа", "error", String(err)) }
  if (!access) return 0
  const base = (s.getString("fcmUrl") || "https://fcm.googleapis.com").replace(/\/+$/, "")
  const strData = {}
  Object.keys(data).forEach((k) => { if (data[k] != null) strData[k] = String(data[k]) })
  let sent = 0
  devices.forEach((d) => {
    try {
      const res = $http.send({
        url: `${base}/v1/projects/${key.project_id}/messages:send`,
        method: "POST",
        headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: d.getString("token"),
            data: strData,
            android: { priority: urgent ? "high" : "normal", ttl: (ttl || 86400) + "s" },
          },
        }),
        timeout: 10,
      })
      if (res.statusCode === 200) sent++
      // Телефон удалил приложение или вышел из аккаунта — больше туда не шлём.
      else if (res.statusCode === 404 || (res.statusCode === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(toString(res.body)))) app.delete(d)
      else if (res.statusCode === 401) app.store().remove("fcm_access")
    } catch (err) {
      app.logger().warn("Firebase: не отправилось", "error", String(err))
    }
  })
  return sent
}

module.exports = { pushToUser, b64url }
