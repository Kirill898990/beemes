/// <reference path="../pb_data/types.d.ts" />
// Свой фон для каждого чата (у каждого свой, собеседник его не видит).
// wallpaper: "" — обычный (соты), "p:<имя>" — готовый фон, "photo:<nonce>.<шифр>" — своё фото:
// фото зашифровано, ключ от него зашифрован ключом владельца — сервер фото не видит.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chat_state")
  c.fields.add(new TextField({ name: "wallpaper", max: 1000 }))
  c.fields.add(new FileField({ name: "wallpaperFile", maxSelect: 1, maxSize: 10 * 1024 * 1024, protected: true }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("chat_state")
  c.fields.removeByName("wallpaper")
  c.fields.removeByName("wallpaperFile")
  app.save(c)
})
