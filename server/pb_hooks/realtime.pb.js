/// <reference path="../pb_data/types.d.ts" />
// Подписка на события в реальном времени — без привязки к IP-адресу.
//
// Обычная подписка PocketBase (POST /api/realtime) отклоняет запрос, если он пришёл не с того IP, что само
// соединение (GET /api/realtime): «Invalid realtime client». А так бывает постоянно — у мобильных операторов
// разные соединения выходят с разных адресов, на iPhone адрес меняет «Частный узел iCloud», браузер шлёт
// подписку по HTTP/3, а соединение держит по HTTP/2. Соединение при этом открыто, но событий нет: новые
// сообщения и «в сети» видны только после перезахода в чат. Здесь вместо IP проверяется вход: подписаться
// может только тот, кто вошёл, и только на соединение без чужого входа (id соединения — 40 случайных символов).
routerAdd("POST", "/api/bm/realtime", (e) => {
  const b = e.requestInfo().body || {}
  const id = String(b.clientId || "")
  const subs = Array.isArray(b.subscriptions) ? b.subscriptions : []
  if (!id || id.length > 255 || subs.length > 1000) throw new BadRequestError("Неверная подписка")
  const topics = subs.map((s) => String(s)).filter((s) => s && s.length <= 2500)
  let client = null
  try { client = $app.subscriptionsBroker().clientById(id) } catch (_) {}
  // 400, а не 404: 404 приложение понимает как «старый сервер без этой подписки»
  if (!client) throw new BadRequestError("Соединение устарело — подключаюсь заново")
  const current = client.get("auth")
  if (current && current.id && (current.id !== e.auth.id || current.collection().id !== e.auth.collection().id)) {
    throw new ForbiddenError("The current and the previous request authorization don't match.")
  }
  client.set("auth", e.auth)
  client.unsubscribe()
  if (topics.length) client.subscribe(...topics)
  return e.noContent(204)
}, $apis.requireAuth("users"))
