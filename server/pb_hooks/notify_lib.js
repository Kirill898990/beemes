// Уведомления о новом сообщении (Firebase и Web Push). Вызывается после сохранения сообщения:
// сразу (старые версии приложения) или отдельным запросом /api/bm/messages/{id}/notify, чтобы медленный
// Firebase не задерживал отправку (см. main.pb.js). Страховка — cron в main.pb.js.

/** Разослать уведомления о сообщении msg всем получателям. */
function pushMessage(app, msg) {
  const { otherMember, displayName } = require(`${__hooks}/lib.js`)
  const { pushToUser } = require(`${__hooks}/fcm_lib.js`)
  const chat = app.findRecordById("chats", msg.getString("chat"))
  const sender = app.findRecordById("users", msg.getString("sender"))
  const body = msg.getString("body")
  const type = chat.getString("type")
  // Личный чат — собеседнику; группа и канал — всем участникам, кроме автора
  // (больших каналов — без уведомлений: сообщения придут, когда откроют beemes).
  const recipients = type ? chat.getStringSlice("members").filter((m) => m !== sender.id) : [otherMember(chat, sender.id)]
  if (recipients.length <= 300) {
    const mutedSet = {}
    app.findRecordsByFilter("chat_state", "chat = {:c} && muted = true", "", 0, 0, { c: chat.id }).forEach((st) => { mutedSet[st.getString("user")] = true })
    const epoch = msg.getInt("epoch")
    const keys = {}
    if (type && epoch > 0) {
      app.findRecordsByFilter("chat_keys", "chat = {:c} && epoch = {:e}", "", 0, 0, { c: chat.id, e: epoch }).forEach((k) => { keys[k.getString("user")] = k })
    }
    const fromKeys = {}
    recipients.forEach((to) => {
      const muted = !!mutedSet[to]
      const data = {
        type: "msg", chat: chat.id, id: msg.id, kind: msg.getString("kind"),
        sender: sender.id, senderName: displayName(sender), senderKey: sender.getString("publicKey"),
        // Текст зашифрован — расшифрует только телефон получателя. Длинные сообщения телефон скачает сам.
        body: body.length <= 3000 ? body : "", nonce: body.length <= 3000 ? msg.getString("nonce") : "",
        silent: muted ? "1" : "",
      }
      if (type) {
        data.chatType = type
        data.chatTitle = chat.getString("title")
        data.epoch = String(epoch)
        if (epoch === 0) data.openKey = chat.getString("openKey")
        const k = keys[to]
        if (k) {
          // Ключ группы, зашифрованный лично для получателя (сервер его не знает).
          const from = k.getString("from")
          if (!(from in fromKeys)) { try { fromKeys[from] = app.findRecordById("users", from).getString("publicKey") } catch (_) { fromKeys[from] = "" } }
          data.keyBody = k.getString("body"); data.keyNonce = k.getString("nonce"); data.keyFrom = from; data.keyFromPub = fromKeys[from]
        }
      }
      try { pushToUser(app, to, data, !muted, 86400) } catch (err) { app.logger().warn("push failed", "error", String(err)) }
    })
  }
}

module.exports = { pushMessage }
