// Общие помощники для обработчиков beemes.

const iso = (t) => new Date(t).toISOString().replace("T", " ")

/** «Петя», «Петя И.» — имя для уведомлений. */
function displayName(user) {
  return (user.getString("name") || "@" + user.getString("username")).slice(0, 64)
}

/** Собеседник в личном чате. */
function otherMember(chat, userId) {
  return chat.getStringSlice("members").find((m) => m !== userId) || ""
}

/** Заблокировал ли [userId] человека [otherId]. */
function hasBlocked(app, userId, otherId) {
  return app.countRecords("blocks", $dbx.hashExp({ user: userId, blocked: otherId })) > 0
}

const RESERVED = ["admin", "administrator", "beemes", "support", "help", "root", "system", "moderator", "official", "security"]

module.exports = { iso, displayName, otherMember, hasBlocked, RESERVED }
