/// <reference path="../pb_data/types.d.ts" />
// Уведомления в браузер и на iPhone (Web Push): адрес подписки длиннее токена Firebase,
// presence — какая это страница beemes (пока она на экране, уведомление ей не нужно).
migrate((app) => {
  const devices = app.findCollectionByNameOrId("devices")
  devices.fields.getByName("token").max = 1000
  devices.fields.add(new TextField({ name: "presence", max: 40, pattern: "^[A-Za-z0-9_-]*$" }))
  app.save(devices)
}, (app) => {
  const devices = app.findCollectionByNameOrId("devices")
  devices.fields.getByName("token").max = 400
  devices.fields.removeByName("presence")
  app.save(devices)
})
