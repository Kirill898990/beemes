/// <reference path="../pb_data/types.d.ts" />
// Группы и каналы: создание, приглашения, участники, админы, выход, поиск публичных каналов.
// Ключ шифрования группы сервер не видит (см. миграцию 1770600000_groups.js) — здесь только кто в группе.

// Создать группу или канал.
// {type: "group"|"channel", title, about, members: [id], isPublic, handle, openKey}
routerAdd("POST", "/api/bm/groups", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const { hasBlocked } = require(`${__hooks}/lib.js`)
  const b = e.requestInfo().body || {}
  const me = e.auth.id
  const type = b.type === "channel" ? "channel" : "group"
  const title = String(b.title || "").trim().slice(0, 64)
  if (!title) throw new BadRequestError("Впишите название")
  // не больше 20 групп/каналов в сутки от одного человека
  const { iso } = require(`${__hooks}/lib.js`)
  if (e.app.countRecords("chats", $dbx.exp("owner = {:me} AND created > {:t}", { me, t: iso(Date.now() - 86400000) })) >= 20) {
    throw new TooManyRequestsError("Слишком много новых групп за сутки")
  }
  const isPublic = type === "channel" && !!b.isPublic
  const collection = e.app.findCollectionByNameOrId("chats")
  const chat = new Record(collection)
  chat.set("type", type)
  chat.set("title", title)
  chat.set("about", String(b.about || "").trim().slice(0, 255))
  chat.set("owner", me)
  chat.set("admins", [me])
  chat.set("isPublic", isPublic)
  if (isPublic) {
    chat.set("handle", G.checkHandle(e.app, b.handle))
    if (!/^[A-Za-z0-9+/]{43}=$/.test(String(b.openKey || ""))) throw new BadRequestError("Нет ключа публичного канала")
    chat.set("openKey", b.openKey)
    chat.set("keyEpoch", 0)
  } else {
    chat.set("keyEpoch", 1)
  }
  chat.set("inviteCode", G.newInviteCode())
  // Участники: только существующие люди, которые не заблокировали создателя.
  const invited = (Array.isArray(b.members) ? b.members : []).slice(0, 200).map(String).filter((id) => {
    if (id === me) return false
    try { e.app.findRecordById("users", id) } catch (_) { return false }
    return !hasBlocked(e.app, id, me)
  })
  G.setMembers(chat, [me].concat(type === "group" ? invited : invited))
  e.app.save(chat)
  return e.json(200, chat)
}, $apis.requireAuth("users"))

// Что за группа по приглашению (до вступления): название, сколько участников.
routerAdd("GET", "/api/bm/invite/{code}", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const code = String(e.request.pathValue("code") || "")
  let chat = null
  if (/^[a-z0-9]{8,32}$/.test(code)) try { chat = e.app.findFirstRecordByFilter("chats", "inviteCode = {:c}", { c: code }) } catch (_) {}
  if (!chat) throw new NotFoundError("Приглашение недействительно — попросите новую ссылку")
  return e.json(200, G.preview(e.app, chat, e.auth.id))
}, $apis.requireAuth("users"))

// Вступить: по приглашению {code} или в публичный канал {chat}.
routerAdd("POST", "/api/bm/join", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const b = e.requestInfo().body || {}
  const me = e.auth.id
  let chat = null
  if (b.code) {
    try { chat = e.app.findFirstRecordByFilter("chats", "inviteCode = {:c}", { c: String(b.code) }) } catch (_) {}
    if (!chat) throw new NotFoundError("Приглашение недействительно — попросите новую ссылку")
  } else {
    try { chat = e.app.findRecordById("chats", String(b.chat || "")) } catch (_) {}
    if (!chat || !chat.getBool("isPublic")) throw new NotFoundError("Канал не найден")
  }
  if (!G.isMember(chat, me)) {
    if (chat.getInt("membersCount") >= 20000) throw new BadRequestError("В группе нет мест")
    G.setMembers(chat, G.memberIds(chat).concat([me]))
    e.app.save(chat)
  }
  return e.json(200, chat)
}, $apis.requireAuth("users"))

// Выйти. Владелец передаёт группу админу (или первому участнику); последний вышедший удаляет группу.
routerAdd("POST", "/api/bm/groups/{id}/leave", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const me = e.auth.id
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), me)
  const rest = G.memberIds(chat).filter((m) => m !== me)
  if (!rest.length) { e.app.delete(chat); return e.json(200, { deleted: true }) }
  if (G.isOwner(chat, me)) {
    const admins = chat.getStringSlice("admins").filter((a) => a !== me && rest.indexOf(a) >= 0)
    const heir = admins[0] || rest[0]
    chat.set("owner", heir)
    if (chat.getStringSlice("admins").indexOf(heir) < 0) chat.set("admins", chat.getStringSlice("admins").concat([heir]))
  }
  chat.set("admins", chat.getStringSlice("admins").filter((a) => a !== me))
  G.setMembers(chat, rest)
  e.app.save(chat)
  return e.json(200, { left: true })
}, $apis.requireAuth("users"))

// Добавить участников (админы). Ключ новым участникам потом отправляет приложение админа.
routerAdd("POST", "/api/bm/groups/{id}/add", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const { hasBlocked } = require(`${__hooks}/lib.js`)
  const me = e.auth.id
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), me)
  if (!G.isAdmin(chat, me)) throw new ForbiddenError("Добавлять могут только админы")
  const b = e.requestInfo().body || {}
  const current = G.memberIds(chat)
  const added = (Array.isArray(b.users) ? b.users : []).slice(0, 200).map(String).filter((id) => {
    if (current.indexOf(id) >= 0) return false
    try { e.app.findRecordById("users", id) } catch (_) { return false }
    return !hasBlocked(e.app, id, me)
  })
  G.setMembers(chat, current.concat(added))
  e.app.save(chat)
  return e.json(200, { added, epoch: chat.getInt("keyEpoch") })
}, $apis.requireAuth("users"))

// Исключить участника (админы; админа — только владелец). Ключ меняется: исключённый не прочтёт новые
// сообщения, даже если у него остался старый ключ. Новый ключ рассылает приложение того, кто исключил.
routerAdd("POST", "/api/bm/groups/{id}/remove", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const me = e.auth.id
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), me)
  const who = String((e.requestInfo().body || {}).user || "")
  if (!G.isAdmin(chat, me)) throw new ForbiddenError("Исключать могут только админы")
  if (who === me) throw new BadRequestError("Чтобы выйти, нажмите «Выйти»")
  if (G.isOwner(chat, who)) throw new ForbiddenError("Владельца исключить нельзя")
  if (G.isAdmin(chat, who) && !G.isOwner(chat, me)) throw new ForbiddenError("Админа может исключить только владелец")
  if (!G.isMember(chat, who)) return e.json(200, { epoch: chat.getInt("keyEpoch") })
  chat.set("admins", chat.getStringSlice("admins").filter((a) => a !== who))
  G.setMembers(chat, G.memberIds(chat).filter((m) => m !== who))
  if (!chat.getBool("isPublic")) {
    chat.set("keyEpoch", chat.getInt("keyEpoch") + 1)
    chat.set("inviteCode", G.newInviteCode())
  }
  e.app.save(chat)
  return e.json(200, { epoch: chat.getInt("keyEpoch") })
}, $apis.requireAuth("users"))

// Назначить или снять админа (владелец).
routerAdd("POST", "/api/bm/groups/{id}/admin", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const me = e.auth.id
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), me)
  if (!G.isOwner(chat, me)) throw new ForbiddenError("Назначать админов может только владелец")
  const b = e.requestInfo().body || {}
  const who = String(b.user || "")
  if (!G.isMember(chat, who)) throw new BadRequestError("Этот человек не в группе")
  const admins = chat.getStringSlice("admins").filter((a) => a !== who)
  if (b.admin) admins.push(who)
  if (admins.length > 50) throw new BadRequestError("Админов не больше 50")
  chat.set("admins", admins)
  e.app.save(chat)
  return e.json(200, { admins })
}, $apis.requireAuth("users"))

// Новая ссылка-приглашение (старая перестаёт работать).
routerAdd("POST", "/api/bm/groups/{id}/invite", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), e.auth.id)
  if (!G.isAdmin(chat, e.auth.id)) throw new ForbiddenError("Только для админов")
  chat.set("inviteCode", G.newInviteCode())
  e.app.save(chat)
  return e.json(200, { inviteCode: chat.getString("inviteCode") })
}, $apis.requireAuth("users"))

// Удалить группу совсем (владелец).
routerAdd("POST", "/api/bm/groups/{id}/delete", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), e.auth.id)
  if (!G.isOwner(chat, e.auth.id)) throw new ForbiddenError("Удалить может только владелец")
  e.app.delete(chat)
  return e.json(200, { deleted: true })
}, $apis.requireAuth("users"))

// Участники (с именами и открытыми ключами). Подписчиков канала видят только админы.
routerAdd("GET", "/api/bm/groups/{id}/members", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const me = e.auth.id
  const chat = G.loadGroup(e.app, e.request.pathValue("id"), me)
  if (chat.getString("type") === "channel" && !G.isAdmin(chat, me)) throw new ForbiddenError("Подписчиков видят только админы")
  const ids = G.memberIds(chat).slice(0, 1000)
  const users = ids.length ? e.app.findRecordsByIds("users", ids) : []
  const keyed = {}
  const epoch = chat.getInt("keyEpoch")
  if (epoch > 0) e.app.findRecordsByFilter("chat_keys", "chat = {:c} && epoch = {:e}", "", 0, 0, { c: chat.id, e: epoch }).forEach((k) => { keyed[k.getString("user")] = true })
  const out = []
  users.forEach((u) => {
    out.push({
      id: u.id, username: u.getString("username"), name: u.getString("name"), avatar: u.getString("avatar"), accent: u.getString("accent"),
      statusEmoji: u.getString("statusEmoji"), publicKey: u.getString("publicKey"),
      admin: G.isAdmin(chat, u.id), owner: G.isOwner(chat, u.id), hasKey: epoch === 0 || !!keyed[u.id],
    })
  })
  return e.json(200, { epoch, members: out })
}, $apis.requireAuth("users"))

// Посты публичного канала — чтобы почитать до подписки. ?before=время — более ранние.
routerAdd("GET", "/api/bm/channels/{id}/posts", (e) => {
  let chat = null
  try { chat = e.app.findRecordById("chats", e.request.pathValue("id")) } catch (_) {}
  if (!chat || !chat.getBool("isPublic")) throw new NotFoundError("Канал не найден")
  const before = String(e.requestInfo().query.before || "")
  const filter = "chat = {:c}" + (/^\d{4}-\d\d-\d\d[ T][\d:.]+Z?$/.test(before) ? " && created < {:b}" : "")
  const list = e.app.findRecordsByFilter("messages", filter, "-created", 61, 0, { c: chat.id, b: before })
  const items = list.slice(0, 60).map((m) => ({
    id: m.id, collectionName: "messages", chat: m.getString("chat"), sender: m.getString("sender"), kind: m.getString("kind"),
    body: m.getString("body"), nonce: m.getString("nonce"), file: m.getString("file"), epoch: m.getInt("epoch"),
    replyTo: m.getString("replyTo"), editedAt: m.getString("editedAt"), created: m.getString("created"),
  }))
  return e.json(200, { items, more: list.length > 60 })
}, $apis.requireAuth("users"))

// Поиск публичных каналов по названию и @имени (?handle= — точное @имя).
routerAdd("GET", "/api/bm/channels", (e) => {
  const G = require(`${__hooks}/groups_lib.js`)
  const exact = String(e.requestInfo().query.handle || "").toLowerCase().replace(/[^a-z0-9_]/g, "")
  if (exact) {
    let c = null
    try { c = e.app.findFirstRecordByFilter("chats", "isPublic = true && handle = {:h}", { h: exact }) } catch (_) {}
    return e.json(200, { items: c ? [G.preview(e.app, c, e.auth.id)] : [] })
  }
  const q = String(e.requestInfo().query.q || "").trim().replace(/^@/, "").replace(/['\\%]/g, "").slice(0, 40)
  if (q.length < 2) return e.json(200, { items: [] })
  // SQLite не различает регистр только у латиницы — для кириллицы пробуем и «мёд», и «Мёд», и «МЁД».
  const lower = q.toLowerCase()
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1)
  const list = e.app.findRecordsByFilter("chats",
    "isPublic = true && (handle ~ {:h} || title ~ {:q} || title ~ {:l} || title ~ {:c} || title ~ {:u})", "-membersCount", 20, 0,
    { h: lower, q, l: lower, c: cap, u: q.toUpperCase() })
  return e.json(200, { items: list.map((c) => G.preview(e.app, c, e.auth.id)) })
}, $apis.requireAuth("users"))

// Через обычный API группу не создать (только /api/bm/groups) и поля групп в личном чате не поставить.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  for (const f of ["type", "title", "about", "owner", "handle", "inviteCode", "openKey"]) e.record.set(f, "")
  e.record.set("admins", [])
  e.record.set("isPublic", false)
  e.record.set("keyEpoch", 0)
  e.next()
}, "chats")

// Админ меняет название, описание, фото и @имя публичного канала.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const G = require(`${__hooks}/groups_lib.js`)
  const title = e.record.getString("title").trim()
  if (!title) throw new BadRequestError("Впишите название")
  e.record.set("title", title.slice(0, 64))
  const old = e.record.original()
  if (e.record.getString("handle") !== old.getString("handle")) {
    if (!e.record.getBool("isPublic")) throw new BadRequestError("@имя бывает только у публичного канала")
    e.record.set("handle", G.checkHandle(e.app, e.record.getString("handle"), e.record.id))
  }
  e.next()
}, "chats")

// Что видят обычные участники: без ссылки-приглашения (её видят админы), а в канале — без списка подписчиков.
onRecordEnrich((e) => {
  const me = e.requestInfo && e.requestInfo.auth
  const chat = e.record
  if (!chat.getString("type")) return e.next()
  const uid = me ? me.id : ""
  const G = require(`${__hooks}/groups_lib.js`)
  const admin = G.isAdmin(chat, uid)
  e.record.withCustomData(true)
  e.record.set("joined", G.isMember(chat, uid))
  if (!admin) e.record.hide("inviteCode")
  if (chat.getString("type") === "channel" && !admin) {
    e.record.hide("members")
    try {
      const ex = e.record.expand()
      if (ex && ex.members) { delete ex.members; e.record.setExpand(ex) }
    } catch (_) { /* без раскрытия */ }
  }
  e.next()
}, "chats")

// Ключ группы для участника: только участнику, только для существующей эпохи. Повторно — не ошибка.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const G = require(`${__hooks}/groups_lib.js`)
  let chat = null
  try { chat = e.app.findRecordById("chats", e.record.getString("chat")) } catch (_) {}
  if (!chat || !G.isGroup(chat) || chat.getBool("isPublic")) throw new BadRequestError("Ключи нужны только приватным группам")
  const epoch = e.record.getInt("epoch")
  if (epoch < 1 || epoch > chat.getInt("keyEpoch")) throw new BadRequestError("Нет такой эпохи ключа")
  if (!G.isMember(chat, e.record.getString("user"))) throw new BadRequestError("Этот человек не в группе")
  if (!/^[A-Za-z0-9+/=]{40,200}$/.test(e.record.getString("body")) || !/^[A-Za-z0-9+/=]{16,32}$/.test(e.record.getString("nonce"))) {
    throw new BadRequestError("Ключ должен быть зашифрован")
  }
  if (e.app.countRecords("chat_keys", $dbx.hashExp({ chat: chat.id, user: e.record.getString("user"), epoch })) > 0) {
    return e.json(200, { exists: true })
  }
  e.next()
}, "chat_keys")
