/// <reference path="../pb_data/types.d.ts" />
// Оформление профиля, как в Telegram:
//  accent  — готовый цвет («honey»…) или свой градиент «g:#RRGGBB:#RRGGBB»;
//  bgEmoji — эмодзи (код Noto, например 1f41d), которым узором украшен фон шапки профиля вокруг аватара.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new TextField({ name: "bgEmoji", max: 40, pattern: "^[0-9a-f_]*$" }))
  const accent = users.fields.getByName("accent")
  accent.max = 24
  accent.pattern = "^([a-z]{0,20}|g:#[0-9A-Fa-f]{6}:#[0-9A-Fa-f]{6})$"
  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("bgEmoji")
  const accent = users.fields.getByName("accent")
  accent.max = 20
  accent.pattern = ""
  app.save(users)
})
