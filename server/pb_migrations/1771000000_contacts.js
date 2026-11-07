/// <reference path="../pb_data/types.d.ts" />
// Регистрация и вход по почте и номеру телефона.
//
// users.phone — подтверждённый номер (+7XXXXXXXXXX). Поле скрытое: номер видит только сам человек
// (через /api/bm/contact) и администратор в панели. Ставится только кодом из SMS.
// bm_settings.smsApiKey — ключ SMS.ru (без него вход и регистрация по телефону не показываются),
// smsUrl — адрес отправки (для тестов), smsDailyLimit — сколько SMS в сутки всего (защита от накрутки).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new TextField({ name: "phone", hidden: true, max: 16, pattern: "^(\\+[0-9]{10,15})?$" }))
  users.addIndex("idx_users_phone", true, "phone", "phone != ''")
  users.updateRule = users.updateRule + " && @request.body.phone:isset = false"
  app.save(users)

  const s = app.findCollectionByNameOrId("bm_settings")
  s.fields.add(new TextField({ name: "smsApiKey", max: 200 }))
  s.fields.add(new URLField({ name: "smsUrl" }))
  s.fields.add(new NumberField({ name: "smsDailyLimit", onlyInt: true, min: 0 }))
  app.save(s)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  users.removeIndex("idx_users_phone")
  users.fields.removeByName("phone")
  users.updateRule = users.updateRule.replace(" && @request.body.phone:isset = false", "")
  app.save(users)
  const s = app.findCollectionByNameOrId("bm_settings")
  for (const f of ["smsApiKey", "smsUrl", "smsDailyLimit"]) s.fields.removeByName(f)
  app.save(s)
})
