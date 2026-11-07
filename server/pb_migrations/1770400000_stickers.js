/// <reference path="../pb_data/types.d.ts" />
// Стикеры: новый вид сообщения. Содержимое, как всегда, зашифровано: {st: "набор/имя", e: "👋", t: "👋"}
// (t — для старых версий приложения: они покажут эмодзи).
migrate((app) => {
  const c = app.findCollectionByNameOrId("messages")
  const kind = c.fields.getByName("kind")
  if (!kind.values.includes("sticker")) kind.values = [...kind.values, "sticker"]
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("messages")
  const kind = c.fields.getByName("kind")
  kind.values = kind.values.filter((v) => v !== "sticker")
  app.save(c)
})
