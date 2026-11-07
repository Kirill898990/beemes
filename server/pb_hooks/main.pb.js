/// <reference path="../pb_data/types.d.ts" />

// Мессенджер beemes: регистрация, чаты, сообщения, «в сети» и уведомления.
// Коллекции — в pb_migrations/1770000000_init.js.

// ---------- Регистрация и ключи ----------

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const { RESERVED } = require(`${__hooks}/lib.js`)
  const username = String(e.record.getString("username")).trim().toLowerCase().replace(/^@/, "")
  e.record.set("username", username)
  e.record.set("name", String(e.record.getString("name")).trim())
  if (RESERVED.indexOf(username) >= 0 || e.app.countRecords("chats", $dbx.hashExp({ handle: username })) > 0) {
    throw new BadRequestError("Это имя занято", { username: new ValidationError("validation_not_unique", "Это имя занято") })
  }
  // Открытый ключ X25519 — ровно 32 байта (44 символа base64).
  if (!/^[A-Za-z0-9+/]{43}=$/.test(e.record.getString("publicKey"))) throw new BadRequestError("Неверный ключ шифрования")
  // Зашифрованный закрытый ключ — скрытые поля: их нельзя ни прочитать, ни найти фильтром.
  // Телефон присылает его как wrappedKey и wrapSalt, а сервер сам кладёт в скрытые поля.
  const body = e.requestInfo().body || {}
  const encKey = String(body.wrappedKey || "")
  const keySalt = String(body.wrapSalt || "")
  if (!/^[A-Za-z0-9+/=]{40,200}$/.test(encKey) || !/^[A-Za-z0-9+/=]{16,64}$/.test(keySalt)) throw new BadRequestError("Не хватает ключа шифрования")
  e.record.set("encKey", encKey)
  e.record.set("keySalt", keySalt)
  e.next()
}, "users")

// Смена пароля: вместе с новым паролем телефон присылает закрытый ключ, зашифрованный новым паролем.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const body = e.requestInfo().body || {}
  if (body.password !== undefined) {
    const encKey = String(body.wrappedKey || "")
    const keySalt = String(body.wrapSalt || "")
    if (!/^[A-Za-z0-9+/=]{40,200}$/.test(encKey) || !/^[A-Za-z0-9+/=]{16,64}$/.test(keySalt)) {
      throw new BadRequestError("Вместе с паролем нужно обновить ключ шифрования")
    }
    e.record.set("encKey", encKey)
    e.record.set("keySalt", keySalt)
  }
  e.next()
  // Пароль сменили — вход на других устройствах завершается (это устройство продлит вход секретом своего сеанса).
  if (body.password !== undefined) {
    const S = require(`${__hooks}/security_lib.js`)
    const others = e.app.findRecordsByFilter("sessions", "user = {:u} && revoked = false && id != {:c}", "", 0, 0, { u: e.record.id, c: S.currentSession(e) })
    others.forEach((s) => { s.set("revoked", true); e.app.save(s) })
  }
}, "users")

// Свой закрытый ключ (зашифрованный паролем) — чтобы читать переписку на новом телефоне.
routerAdd("GET", "/api/bm/keys", (e) => {
  const u = e.app.findRecordById("users", e.auth.id)
  return e.json(200, { publicKey: u.getString("publicKey"), encKey: u.getString("encKey"), keySalt: u.getString("keySalt") })
}, $apis.requireAuth("users"))

// Свободно ли @имя (при регистрации).
routerAdd("GET", "/api/bm/username/{name}", (e) => {
  const { RESERVED } = require(`${__hooks}/lib.js`)
  const name = String(e.request.pathValue("name") || "").toLowerCase().replace(/^@/, "")
  if (!/^[a-z0-9_]{3,32}$/.test(name)) return e.json(200, { free: false, reason: "format" })
  const taken = RESERVED.indexOf(name) >= 0 || e.app.countRecords("users", $dbx.hashExp({ username: name })) > 0 ||
    e.app.countRecords("chats", $dbx.hashExp({ handle: name })) > 0
  return e.json(200, { free: !taken })
})

// Приложение открыто — человек «в сети». Телефон присылает раз в минуту.
// Кнопка «Проверить уведомления»: пробное уведомление на все мои телефоны и отчёт, что получилось.
routerAdd("POST", "/api/bm/push-test", (e) => {
  const { pushToUser } = require(`${__hooks}/fcm_lib.js`)
  const report = {}
  pushToUser(e.app, e.auth.id, { type: "test" }, true, 600, report)
  return e.json(200, report)
}, $apis.requireAuth("users"))

// ---------- Живые эмодзи ----------
// Самые нужные лежат в pb_public/emoji. Остальные анимации Noto (группы «Ещё …» в index.json) сервер скачивает
// у Google один раз при первом запросе и хранит в pb_data/emoji — телефоны и браузеры к Google не обращаются.
routerAdd("GET", "/emoji/{name}", (e) => {
  const name = e.request.pathValue("name")
  if (!/^([0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,7}|index)\.json$/.test(name)) throw new NotFoundError()
  const send = (bytes) => {
    e.response.header().set("Cache-Control", name === "index.json" ? "no-cache" : "public, max-age=2592000, immutable")
    return e.blob(200, "application/json", bytes)
  }
  const local = `${__hooks}/../pb_public/emoji/${name}`
  try { return send($os.readFile(local)) } catch (_) { /* ниже */ }
  const dir = e.app.dataDir() + "/emoji"
  try { return send($os.readFile(`${dir}/${name}`)) } catch (_) { /* ниже */ }
  // Только то, что есть в списке, — сервер не скачивает что попало.
  const code = name.replace(/\.json$/, "")
  let codes = e.app.store().get("emoji_codes")
  if (!codes) {
    codes = {}
    try {
      JSON.parse(toString($os.readFile(`${__hooks}/../pb_public/emoji/index.json`))).forEach((g) => g.items.forEach((it) => { codes[it.c] = true }))
    } catch (_) { /* пустой список */ }
    e.app.store().set("emoji_codes", codes)
  }
  if (!codes[code]) throw new NotFoundError()
  const res = $http.send({ url: `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/lottie.json`, method: "GET", timeout: 20 })
  const text = toString(res.body)
  if (res.statusCode !== 200 || text.charAt(0) !== "{") throw new NotFoundError()
  try { $os.mkdirAll(dir, 0o755); $os.writeFile(`${dir}/${name}`, text, 0o644) } catch (err) { e.app.logger().warn("emoji cache", "error", String(err)) }
  return send(text)
})

// ---------- Уведомления в браузер и на iPhone (Web Push) ----------

// Открытый ключ сервера — браузер подписывается на уведомления с ним.
routerAdd("GET", "/api/bm/webpush-key", (e) => {
  const { publicKey } = require(`${__hooks}/webpush_lib.js`)
  return e.json(200, { key: publicKey(e.app) })
})

// Устройство проснулось от уведомления и забирает, что показать. Пропуск — сам адрес подписки:
// его знают только этот браузер, служба уведомлений и сервер (как и данные уведомления на Android).
// Текст сообщений зашифрован — расшифрует только само устройство.
routerAdd("POST", "/api/bm/push-inbox", (e) => {
  const { takeQueue } = require(`${__hooks}/webpush_lib.js`)
  const endpoint = String((e.requestInfo().body || {}).endpoint || "")
  let device = null
  if (endpoint) {
    try { device = e.app.findFirstRecordByFilter("devices", "token = {:t} && platform = 'web'", { t: endpoint }) } catch (_) {}
  }
  if (!device) return e.json(404, { items: [] })
  return e.json(200, { items: takeQueue(e.app, device.id) })
})

// Старые версии приложения раз в минуту отмечаются здесь — считаем их «в сети» ещё 90 секунд.
routerAdd("POST", "/api/bm/online", (e) => {
  const { presenceUpdate } = require(`${__hooks}/lib.js`)
  presenceUpdate(e.app, e.auth.id, "legacy", "online", 0, 90 * 1000)
  return e.json(200, { ok: true })
}, $apis.requireAuth("users"))

// «В сети» без задержки. Приложение сообщает: открыто (state=online, каждые 20 секунд) или свёрнуто/закрыто
// (state=offline). У человека может быть несколько устройств — «в сети», пока открыто хоть одно.
// seq — номер сигнала от устройства: если «вышел» дошёл позже, чем «вернулся», старый не учитываем.
// При закрытии страницы браузер шлёт «вышел» маячком (sendBeacon) — без заголовков, поэтому вход в теле (token).
routerAdd("POST", "/api/bm/presence", (e) => {
  const { presenceUpdate } = require(`${__hooks}/lib.js`)
  const body = e.requestInfo().body || {}
  let auth = e.auth
  if (!auth && body.token) {
    try { auth = e.app.findAuthRecordByToken(String(body.token), "auth") } catch (_) { auth = null }
  }
  if (!auth || auth.collection().name !== "users") throw new UnauthorizedError("Нужно войти")
  const state = body.state === "online" ? "online" : "offline"
  const device = String(body.device || "default").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "default"
  const online = presenceUpdate(e.app, auth.id, device, state, Number(body.seq) || 0, 45 * 1000)
  // Сеанс этого устройства был активен (для списка «Устройства»; пишем не чаще раза в 5 минут).
  const sid = String(body.session || "").replace(/[^a-z0-9]/g, "")
  if (sid && !e.app.store().get("touch:" + sid)) {
    const { iso } = require(`${__hooks}/lib.js`)
    e.app.store().set("touch:" + sid, Date.now())
    e.app.db().newQuery("UPDATE sessions SET lastActive = {:t}, ip = {:ip} WHERE id = {:id} AND user = {:u} AND revoked = 0")
      .bind({ t: iso(Date.now()), ip: e.realIP(), id: sid, u: auth.id }).execute()
  }
  return e.json(200, { online })
})

// «Был(а) в сети» и «в сети» видят все, кроме тех случаев, когда человек это скрыл.
onRecordEnrich((e) => {
  const me = e.requestInfo && e.requestInfo.auth
  if (e.record.getBool("hideLastSeen") && (!me || me.id !== e.record.id)) {
    e.record.set("lastSeen", "")
    e.record.set("onlineUntil", "")
  }
  e.next()
}, "users")

// Фон чата — личный: собеседник видит ваши «прочитано» и «без звука», но не ваш фон.
onRecordEnrich((e) => {
  const me = e.requestInfo && e.requestInfo.auth
  if (!me || me.id !== e.record.getString("user")) e.record.hide("wallpaper", "wallpaperFile")
  e.next()
}, "chat_state")

// ---------- Чаты ----------

// Один чат на пару людей: если он уже есть, отвечаем им же.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const members = e.record.getStringSlice("members")
  const me = e.auth.id
  const other = members.find((m) => m !== me)
  if (members.length !== 2 || !other || members.indexOf(me) < 0) throw new BadRequestError("В личном чате двое: вы и собеседник")
  try { e.app.findRecordById("users", other) } catch (_) { throw new NotFoundError("Такого человека нет") }
  const pair = [me, other].sort().join("_")
  try {
    const existing = e.app.findFirstRecordByFilter("chats", "pair = {:p}", { p: pair })
    return e.json(200, existing)
  } catch (_) {}
  e.record.set("pair", pair)
  e.next()
}, "chats")

// ---------- Сообщения ----------

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const { otherMember, hasBlocked } = require(`${__hooks}/lib.js`)
  // Лимит на человека (лимиты PocketBase — на IP-адрес, а с одного адреса пишут сотни людей).
  const rateKey = "msgrate:" + e.auth.id
  const now = Date.now()
  const rate = e.app.store().get(rateKey)
  if (rate && now - rate.t < 10000) {
    if (rate.n >= 60) throw new TooManyRequestsError("Слишком много сообщений подряд — подождите пару секунд")
    rate.n++
    e.app.store().set(rateKey, rate)
  } else e.app.store().set(rateKey, { t: now, n: 1 })
  const chat = e.app.findRecordById("chats", e.record.getString("chat"))
  const type = chat.getString("type")
  if (!type) {
    const other = otherMember(chat, e.auth.id)
    if (hasBlocked(e.app, other, e.auth.id)) throw new ForbiddenError("Этот человек ограничил, кто может ему писать")
    e.record.set("epoch", 0)
  } else {
    const G = require(`${__hooks}/groups_lib.js`)
    if (type === "channel" && !G.isAdmin(chat, e.auth.id)) throw new ForbiddenError("В канале пишут только админы")
    // Сообщение зашифровано ключом текущей эпохи (в публичном канале — открытым ключом, эпоха 0).
    if (e.record.getInt("epoch") !== chat.getInt("keyEpoch")) throw new BadRequestError("Ключ группы обновился — откройте чат заново")
  }
  const kind = e.record.getString("kind")
  if (!e.record.getString("body") || !/^[A-Za-z0-9+/=]{16,32}$/.test(e.record.getString("nonce"))) {
    throw new BadRequestError("Сообщение должно быть зашифровано")
  }
  // Только что загруженный файл ещё не сохранён — он среди «несохранённых файлов» записи.
  const hasFile = e.record.getUnsavedFiles("file").length > 0
  if (kind === "photo" && !hasFile) throw new BadRequestError("Не хватает фото")
  if (kind !== "photo" && hasFile) throw new BadRequestError("Файл можно прикрепить только к фото")
  const reply = e.record.getString("replyTo")
  if (reply) {
    let r = null
    try { r = e.app.findRecordById("messages", reply) } catch (_) {}
    if (!r || r.getString("chat") !== chat.id) e.record.set("replyTo", "")
  }
  e.record.set("editedAt", "")
  // Приложение само попросит разослать уведомления (/api/bm/messages/{id}/notify) — отправка не ждёт Firebase.
  const later = (e.requestInfo().body || {}).pushLater
  if (later === true || later === "1" || later === "true") {
    if (!e.record.id) e.record.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"))
    e.app.store().set("pushlater:" + e.record.id, Date.now())
  }
  e.next()
}, "messages")

onRecordAfterCreateSuccess((e) => {
  const { iso } = require(`${__hooks}/lib.js`)
  const msg = e.record
  const chatId = msg.getString("chat")
  const now = iso(Date.now())
  e.app.db().newQuery("UPDATE chats SET lastMessageAt = {:t}, lastMessage = {:m} WHERE id = {:id}").bind({ t: now, m: msg.id, id: chatId }).execute()
  // Новое сообщение возвращает скрытый чат в список у обоих.
  e.app.db().newQuery("UPDATE chat_state SET hidden = 0 WHERE chat = {:c}").bind({ c: chatId }).execute()
  // Новые версии приложения просят уведомить получателей отдельным запросом (pushLater) — отправка не ждёт Firebase.
  if (e.app.store().get("pushlater:" + msg.id)) {
    e.app.store().remove("pushlater:" + msg.id)
    e.app.store().set("pushq:" + msg.id, { sender: msg.getString("sender"), t: Date.now() })
  } else {
    try { require(`${__hooks}/notify_lib.js`).pushMessage(e.app, msg) } catch (err) { e.app.logger().warn("push failed", "error", String(err)) }
  }
  e.next()
}, "messages")

// Разослать уведомления о только что отправленном сообщении (приложение вызывает сразу после отправки).
routerAdd("POST", "/api/bm/messages/{id}/notify", (e) => {
  const id = e.request.pathValue("id")
  const q = e.app.store().get("pushq:" + id)
  if (!q) return e.json(200, { queued: false })
  if (q.sender !== e.auth.id) throw new NotFoundError("Не найдено")
  e.app.store().remove("pushq:" + id)
  let msg = null
  try { msg = e.app.findRecordById("messages", id) } catch (_) {}
  if (msg) require(`${__hooks}/notify_lib.js`).pushMessage(e.app, msg)
  return e.json(200, { queued: true })
}, $apis.requireAuth("users"))

// Страховка: если приложение не успело попросить (закрыли сразу после отправки) — разошлём сами.
cronAdd("bm_push_flush", "* * * * *", () => {
  const all = $app.store().getAll()
  const now = Date.now()
  Object.keys(all).forEach((k) => {
    if (k.indexOf("pushq:") === 0) {
      const q = all[k]
      if (!q || now - q.t < 15000) return
      $app.store().remove(k)
      let msg = null
      try { msg = $app.findRecordById("messages", k.slice(6)) } catch (_) {}
      if (msg) { try { require(`${__hooks}/notify_lib.js`).pushMessage($app, msg) } catch (err) { $app.logger().warn("push failed", "error", String(err)) } }
    } else if (k.indexOf("pushlater:") === 0 && now - Number(all[k]) > 600000) {
      $app.store().remove(k)
    }
  })
})

// Удалили последнее сообщение — в списке чатов показываем предыдущее.
onRecordAfterDeleteSuccess((e) => {
  const chatId = e.record.getString("chat")
  let prev = null
  try { prev = e.app.findRecordsByFilter("messages", "chat = {:c}", "-created", 1, 0, { c: chatId })[0] || null } catch (_) {}
  // (PocketBase уже стёр ссылку на удалённое сообщение — просто ставим последнее оставшееся.)
  e.app.db().newQuery("UPDATE chats SET lastMessage = {:m} WHERE id = {:id}").bind({ m: prev ? prev.id : "", id: chatId }).execute()
  e.next()
}, "messages")

// Сколько непрочитанных в каждом чате: сообщения собеседника новее моей отметки «прочитано».
routerAdd("GET", "/api/bm/unread", (e) => {
  const rows = arrayOf(new DynamicModel({ chat: "", n: 0 }))
  e.app.db().newQuery(
    "SELECT m.chat AS chat, COUNT(*) AS n FROM messages m " +
    "JOIN chats c ON c.id = m.chat " +
    "LEFT JOIN chat_state s ON s.chat = m.chat AND s.user = {:me} " +
    "WHERE (c.members LIKE {:like}) AND m.sender != {:me} AND (s.readAt IS NULL OR s.readAt = '' OR m.created > s.readAt) " +
    "GROUP BY m.chat",
  ).bind({ me: e.auth.id, like: "%\"" + e.auth.id + "\"%" }).all(rows)
  const out = {}
  rows.forEach((r) => { out[r.chat] = r.n })
  return e.json(200, { unread: out })
}, $apis.requireAuth("users"))

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const { iso } = require(`${__hooks}/lib.js`)
  if (!/^[A-Za-z0-9+/=]{16,32}$/.test(e.record.getString("nonce")) || !e.record.getString("body")) {
    throw new BadRequestError("Сообщение должно быть зашифровано")
  }
  e.record.set("editedAt", iso(Date.now()))
  e.next()
}, "messages")

// ---------- Блокировки и телефоны ----------

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  try {
    const existing = e.app.findFirstRecordByFilter("blocks", "user = {:u} && blocked = {:b}", { u: e.auth.id, b: e.record.getString("blocked") })
    return e.json(200, existing)
  } catch (_) {}
  e.next()
}, "blocks")

// Один и тот же телефон мог раньше принадлежать другому аккаунту — переписываем на нового владельца.
// Браузер (Web Push): адрес подписки — только служба уведомлений браузера.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (e.record.getString("platform") === "web") {
    const { allowedEndpoint } = require(`${__hooks}/webpush_lib.js`)
    if (!allowedEndpoint(e.record.getString("token"))) throw new BadRequestError("Неизвестная служба уведомлений")
  }
  try {
    const old = e.app.findFirstRecordByFilter("devices", "token = {:t}", { t: e.record.getString("token") })
    e.app.delete(old)
  } catch (_) {}
  e.next()
}, "devices")

// ---------- Защита ----------

// После 10 неверных паролей к одному @имени вход в аккаунт закрыт на 15 минут.
onRecordAuthWithPasswordRequest((e) => {
  if (!e.record) return e.next()
  const store = e.app.store()
  const key = "login_fail:" + e.record.collection().name + ":" + e.record.id
  const now = Date.now()
  let info = store.get(key)
  if (info && info.until > now) {
    throw new TooManyRequestsError(`Слишком много неверных паролей. Попробуйте через ${Math.ceil((info.until - now) / 60000)} мин.`)
  }
  try {
    e.next()
  } catch (err) {
    if (!info || now - info.since > 15 * 60 * 1000) info = { n: 0, since: now, until: 0 }
    info.n++
    if (info.n >= 10) info = { n: 0, since: now, until: now + 15 * 60 * 1000 }
    store.set(key, info)
    throw err
  }
  store.remove(key)
})

routerUse((e) => {
  const h = e.response.header()
  h.set("X-Content-Type-Options", "nosniff")
  h.set("X-Frame-Options", "SAMEORIGIN")
  h.set("Referrer-Policy", "strict-origin-when-cross-origin")
  h.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()")
  const path = e.request.url.path
  if (!path.startsWith("/api/") && !path.startsWith("/_/")) h.set("Cache-Control", "no-cache")
  const host = String(e.request.host || "")
  if (!/^(127\.|localhost|\[::1\]|10\.|192\.168\.)/.test(host)) h.set("Strict-Transport-Security", "max-age=31536000")
  return e.next()
})

// За Caddy (BEHIND_PROXY=1 в server.env) настоящий адрес посетителя приходит в заголовке X-Forwarded-For —
// по нему работают лимиты запросов. Без Caddy заголовку верить нельзя (его может подделать любой), поэтому выключаем.
onBootstrap((e) => {
  e.next()
  const want = $os.getenv("BEHIND_PROXY") === "1" ? ["X-Forwarded-For"] : []
  const s = $app.settings()
  const have = Array.from(s.trustedProxy.headers || [])
  if (have.join(",") !== want.join(",")) {
    s.trustedProxy.headers = want
    s.trustedProxy.useLeftmostIP = false
    $app.save(s)
  }
})
