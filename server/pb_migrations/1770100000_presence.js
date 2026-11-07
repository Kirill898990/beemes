/// <reference path="../pb_data/types.d.ts" />

// «В сети» без задержки: onlineUntil — до какого момента человек точно в сети.
// Открыл beemes — сервер ставит «сейчас + 70 секунд» и продлевает, пока приложение открыто.
// Свернул или закрыл — сразу «сейчас», и собеседники видят это сразу (обновление приходит в реальном времени).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new DateField({ name: "onlineUntil" }))
  users.createRule = "@request.body.lastSeen:isset = false && @request.body.onlineUntil:isset = false"
  users.updateRule = "id = @request.auth.id && @request.body.publicKey:isset = false && @request.body.lastSeen:isset = false && @request.body.onlineUntil:isset = false"
  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("onlineUntil")
  users.createRule = "@request.body.lastSeen:isset = false"
  users.updateRule = "id = @request.auth.id && @request.body.publicKey:isset = false && @request.body.lastSeen:isset = false"
  app.save(users)
})
