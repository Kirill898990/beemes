/// <reference path="../pb_data/types.d.ts" />
// Админ-панель и галочки.
//
// users.admin — доступ к админ-панели. Ставится только в панели PocketBase (Collections → users → запись → admin):
// поле скрытое, сам человек его не видит и не поменяет. users.badge и chats.badge — галочка у человека и у канала
// (группы): ставит только админ через /api/bm/admin/badge.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new BoolField({ name: "admin", hidden: true }))
  users.fields.add(new BoolField({ name: "badge" }))
  users.updateRule = users.updateRule + " && @request.body.admin:isset = false && @request.body.badge:isset = false"
  app.save(users)

  const chats = app.findCollectionByNameOrId("chats")
  chats.fields.add(new BoolField({ name: "badge" }))
  chats.updateRule = chats.updateRule + " && @request.body.badge:isset = false"
  app.save(chats)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("admin")
  users.fields.removeByName("badge")
  users.updateRule = users.updateRule.replace(" && @request.body.admin:isset = false && @request.body.badge:isset = false", "")
  app.save(users)
  const chats = app.findCollectionByNameOrId("chats")
  chats.fields.removeByName("badge")
  chats.updateRule = chats.updateRule.replace(" && @request.body.badge:isset = false", "")
  app.save(chats)
})
