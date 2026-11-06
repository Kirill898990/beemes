/// <reference path="../pb_data/types.d.ts" />

// Звонки: голос и видео идут напрямую между телефонами (WebRTC, шифруются сами — DTLS-SRTP),
// а если напрямую не получается — через свой TURN-сервер (coturn ставит install.sh).
// Договариваются телефоны через call_signals: ring → accept → offer → answer → hangup.
//
// GET /api/bm/ice      — адреса STUN/TURN и временный пароль для TURN.
// GET /api/bm/incoming — кто сейчас звонит (на случай, если push не дошёл).

routerAdd("GET", "/api/bm/ice", (e) => {
  const { iceServers } = require(`${__hooks}/call_lib.js`)
  const host = $os.getenv("TURN_HOST") || String(e.request.host || "").replace(/:\d+$/, "")
  return e.json(200, { iceServers: iceServers($os.getenv("TURN_SECRET"), host, e.auth.id) })
}, $apis.requireAuth("users"))

routerAdd("GET", "/api/bm/incoming", (e) => {
  const { iso } = require(`${__hooks}/lib.js`)
  const rings = e.app.findRecordsByFilter("call_signals", "to = {:me} && type = 'ring' && created > {:t}", "-created", 5, 0,
    { me: e.auth.id, t: iso(Date.now() - 45 * 1000) })
  for (const r of rings) {
    const done = e.app.countRecords("call_signals",
      $dbx.exp("call = {:c} AND type IN ('accept', 'decline', 'busy', 'hangup')", { c: r.getString("call") }))
    if (done) continue
    let data = {}
    try { data = JSON.parse(r.getString("data") || "{}") || {} } catch (_) {}
    return e.json(200, { call: { id: r.getString("call"), chat: r.getString("chat"), from: r.getString("from"), name: data.name || "", video: !!data.video } })
  }
  return e.json(200, { call: null })
}, $apis.requireAuth("users"))

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const { iso, hasBlocked, displayName } = require(`${__hooks}/lib.js`)
  const chat = e.app.findRecordById("chats", e.record.getString("chat"))
  if (chat.getStringSlice("members").indexOf(e.record.getString("to")) < 0) throw new BadRequestError("Звонить можно только собеседнику по чату")
  if (e.record.getString("type") === "ring") {
    if (hasBlocked(e.app, e.record.getString("to"), e.auth.id)) throw new ForbiddenError("Этот человек ограничил, кто может ему звонить")
    const recent = e.app.countRecords("call_signals",
      $dbx.exp("[[from]] = {:f} AND type = 'ring' AND created > {:t}", { f: e.auth.id, t: iso(Date.now() - 60 * 1000) }))
    if (recent >= 5) throw new TooManyRequestsError("Слишком много звонков подряд. Подождите минуту.")
    let data = {}
    try { data = JSON.parse(e.record.getString("data") || "{}") || {} } catch (_) {}
    e.record.set("data", { video: !!data.video, name: displayName(e.auth) })
  }
  e.next()
}, "call_signals")

// Звонок: будим телефон собеседника. Конец звонка: убираем «Входящий звонок» с его других телефонов.
onRecordAfterCreateSuccess((e) => {
  const { pushToUser } = require(`${__hooks}/fcm_lib.js`)
  const s = e.record
  const type = s.getString("type")
  try {
    if (type === "ring") {
      let data = {}
      try { data = JSON.parse(s.getString("data") || "{}") || {} } catch (_) {}
      pushToUser(e.app, s.getString("to"), {
        type: "call", call: s.getString("call"), chat: s.getString("chat"), from: s.getString("from"),
        name: data.name || "", video: data.video ? "1" : "",
      }, true, 45)
    } else if (type === "hangup" || type === "accept" || type === "decline") {
      // Отменяем звонок у того, кто ему не отвечал (и на других телефонах ответившего).
      pushToUser(e.app, s.getString("to"), { type: "call_end", call: s.getString("call") }, true, 60)
      if (type !== "hangup") pushToUser(e.app, s.getString("from"), { type: "call_end", call: s.getString("call"), here: "1" }, true, 60)
    }
  } catch (err) {
    e.app.logger().warn("call push failed", "error", String(err))
  }
  e.next()
}, "call_signals")

cronAdd("call_signals_cleanup", "23 * * * *", () => {
  $app.db().newQuery("DELETE FROM call_signals WHERE created < {:t}")
    .bind({ t: new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace("T", " ") }).execute()
})
