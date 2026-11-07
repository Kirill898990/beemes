// Админ-панель (см. admin.pb.js).

/** Только для админа (users.admin ставится в панели PocketBase). Остальным — «не найдено», будто панели нет. */
function requireAdmin(e) {
  const me = e.auth && e.app.findRecordById("users", e.auth.id)
  if (!me || !me.getBool("admin")) throw new NotFoundError("Не найдено")
  return me
}

const userRow = (u) => ({
  kind: "user", id: u.id, name: u.getString("name"), username: u.getString("username"), avatar: u.getString("avatar"),
  accent: u.getString("accent"), badge: u.getBool("badge"),
})

const chatRow = (c) => ({
  kind: "chat", id: c.id, type: c.getString("type"), title: c.getString("title"), handle: c.getString("handle"), photo: c.getString("photo"),
  isPublic: c.getBool("isPublic"), membersCount: c.getInt("membersCount"), badge: c.getBool("badge"),
})

/** «мёд» → и «Мёд», и «МЁД»: SQLite не различает регистр только у латиницы. */
function variants(q) {
  const lower = q.toLowerCase()
  return { q, l: lower, c: lower.charAt(0).toUpperCase() + lower.slice(1), u: q.toUpperCase() }
}

module.exports = { requireAdmin, userRow, chatRow, variants }
