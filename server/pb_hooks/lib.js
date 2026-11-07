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


// «В сети» по устройствам: у каждого своё «открыт до» (u), номер последнего сигнала (s) и время (t).
// Запись человека сохраняем, только когда статус меняется или пора продлить, — тогда собеседникам
// сразу уходит обновление в реальном времени, а база не пишется на каждый сигнал.
function presenceUpdate(app, userId, device, state, seq, ttl) {
  const now = Date.now()
  const key = "presence:" + userId
  const devices = {}
  const stored = app.store().get(key) || {}
  Object.keys(stored).forEach((d) => {
    const v = stored[d] || {}
    // помним и отключившиеся устройства (их номер), но не дольше 10 минут
    if (Number(v.u) > now || now - Number(v.t) < 10 * 60 * 1000) devices[d] = { u: Number(v.u) || 0, s: Number(v.s) || 0, t: Number(v.t) || 0 }
  })
  const prev = devices[device]
  if (!(prev && seq && prev.s && seq < prev.s)) {
    devices[device] = { u: state === "online" ? now + ttl : 0, s: seq || (prev ? prev.s : 0), t: now }
    app.store().set(key, devices)
  }
  const until = Object.keys(devices).reduce((m, d) => Math.max(m, devices[d].u), 0)
  const user = app.findRecordById("users", userId)
  const cur = user.getString("onlineUntil")
  const current = cur ? new Date(cur.replace(" ", "T")).getTime() : 0
  const wasOnline = current > now
  const isOnline = until > now
  if (isOnline !== wasOnline || (isOnline && current - now < 20 * 1000)) {
    user.set("onlineUntil", iso(isOnline ? until : now))
    user.set("lastSeen", iso(now))
    app.saveNoValidate(user)
  }
  return isOnline
}

module.exports = { presenceUpdate, iso, displayName, otherMember, hasBlocked, RESERVED }
