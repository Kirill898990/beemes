/// <reference path="../pb_data/types.d.ts" />
// Админ-панель: выдать или снять галочку человеку, каналу или группе. Общее — в admin_lib.js.

// Я админ? (поле admin скрытое — приложение спрашивает здесь, показывать ли пункт «Админ-панель»)
routerAdd("GET", "/api/bm/admin/me", (e) => {
  const me = e.app.findRecordById("users", e.auth.id)
  return e.json(200, { admin: me.getBool("admin") })
}, $apis.requireAuth("users"))

// Поиск людей и каналов (?kind=users|chats&q=…). Без запроса — все, у кого уже есть галочка.
routerAdd("GET", "/api/bm/admin/search", (e) => {
  const A = require(`${__hooks}/admin_lib.js`)
  A.requireAdmin(e)
  const kind = String(e.requestInfo().query.kind || "users")
  const q = String(e.requestInfo().query.q || "").trim().replace(/^@/, "").replace(/['\\%]/g, "").slice(0, 40)
  if (kind === "chats") {
    const list = q
      ? e.app.findRecordsByFilter("chats", "type != '' && (handle ~ {:l} || title ~ {:q} || title ~ {:l} || title ~ {:c} || title ~ {:u})", "-membersCount", 40, 0, A.variants(q))
      : e.app.findRecordsByFilter("chats", "type != '' && badge = true", "-membersCount", 200, 0)
    return e.json(200, { items: list.map(A.chatRow) })
  }
  const list = q
    ? e.app.findRecordsByFilter("users", "username ~ {:l} || name ~ {:q} || name ~ {:l} || name ~ {:c} || name ~ {:u}", "username", 40, 0, A.variants(q))
    : e.app.findRecordsByFilter("users", "badge = true", "username", 200, 0)
  return e.json(200, { items: list.map(A.userRow) })
}, $apis.requireAuth("users"))

// Выдать / снять галочку: { kind: "user" | "chat", id, badge: true | false }
routerAdd("POST", "/api/bm/admin/badge", (e) => {
  const A = require(`${__hooks}/admin_lib.js`)
  const me = A.requireAdmin(e)
  const b = e.requestInfo().body || {}
  const chat = b.kind === "chat"
  let r = null
  try { r = e.app.findRecordById(chat ? "chats" : "users", String(b.id || "")) } catch (_) {}
  if (!r || (chat && !r.getString("type"))) throw new NotFoundError(chat ? "Канал не найден" : "Человек не найден")
  r.set("badge", !!b.badge)
  e.app.save(r)
  e.app.logger().info("badge", "admin", me.id, "kind", chat ? "chat" : "user", "id", r.id, "badge", !!b.badge)
  return e.json(200, chat ? A.chatRow(r) : A.userRow(r))
}, $apis.requireAuth("users"))

// Ни админом, ни с галочкой не зарегистрироваться и не создать чат (только админ-панель и панель PocketBase).
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) { e.record.set("admin", false); e.record.set("badge", false) }
  e.next()
}, "users")

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set("badge", false)
  e.next()
}, "chats")
