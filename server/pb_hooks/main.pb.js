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
  if (RESERVED.indexOf(username) >= 0) {
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
  const taken = RESERVED.indexOf(name) >= 0 || e.app.countRecords("users", $dbx.hashExp({ username: name })) > 0
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
  const chat = e.app.findRecordById("chats", e.record.getString("chat"))
  const other = otherMember(chat, e.auth.id)
  if (hasBlocked(e.app, other, e.auth.id)) throw new ForbiddenError("Этот человек ограничил, кто может ему писать")
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
  e.next()
}, "messages")

onRecordAfterCreateSuccess((e) => {
  const { iso, otherMember, displayName } = require(`${__hooks}/lib.js`)
  const { pushToUser } = require(`${__hooks}/fcm_lib.js`)
  const msg = e.record
  const chat = e.app.findRecordById("chats", msg.getString("chat"))
  const now = iso(Date.now())
  e.app.db().newQuery("UPDATE chats SET lastMessageAt = {:t}, lastMessage = {:m} WHERE id = {:id}").bind({ t: now, m: msg.id, id: chat.id }).execute()
  // Новое сообщение возвращает скрытый чат в список у обоих.
  e.app.db().newQuery("UPDATE chat_state SET hidden = 0 WHERE chat = {:c}").bind({ c: chat.id }).execute()
  const sender = e.app.findRecordById("users", msg.getString("sender"))
  const to = otherMember(chat, sender.id)
  let muted = false
  try { muted = e.app.findFirstRecordByFilter("chat_state", "chat = {:c} && user = {:u}", { c: chat.id, u: to }).getBool("muted") } catch (_) {}
  const body = msg.getString("body")
  try {
    pushToUser(e.app, to, {
      type: "msg", chat: chat.id, id: msg.id, kind: msg.getString("kind"),
      sender: sender.id, senderName: displayName(sender), senderKey: sender.getString("publicKey"),
      // Текст зашифрован — расшифрует только телефон получателя. Длинные сообщения телефон скачает сам.
      body: body.length <= 3000 ? body : "", nonce: body.length <= 3000 ? msg.getString("nonce") : "",
      silent: muted ? "1" : "",
    }, !muted, 86400)
  } catch (err) {
    e.app.logger().warn("push failed", "error", String(err))
  }
  e.next()
}, "messages")

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
