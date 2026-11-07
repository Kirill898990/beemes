/// <reference path="../pb_data/types.d.ts" />
// Устройства (сеансы), вход по QR-коду, 2FA по почте.
//
// sessions — каждый вход: с какого устройства, IP, когда. У устройства есть секрет сеанса (хранится только хэш):
// по нему приложение незаметно продлевает вход. «Завершить сеанс» помечает его закрытым и меняет ключ входа
// у человека — все старые пропуска перестают работать, живые устройства продлевают вход секретом, а закрытое — нет.
// users.twoFactor — при входе по паролю нужен ещё код из письма на подтверждённую почту.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new BoolField({ name: "twoFactor" }))
  users.updateRule = "id = @request.auth.id" + [
    "publicKey", "lastSeen", "onlineUntil", "twoFactor", "email", "verified", "emailVisibility",
  ].map((f) => ` && @request.body.${f}:isset = false`).join("")
  app.save(users)

  const s = new Collection({
    type: "base",
    name: "sessions",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  })
  s.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  s.fields.add(new TextField({ name: "name", max: 120 }))
  s.fields.add(new TextField({ name: "platform", max: 20 }))
  s.fields.add(new TextField({ name: "ip", max: 64 }))
  s.fields.add(new TextField({ name: "how", max: 20 }))
  s.fields.add(new TextField({ name: "secretHash", max: 128, hidden: true }))
  s.fields.add(new BoolField({ name: "revoked" }))
  s.fields.add(new DateField({ name: "lastActive" }))
  s.fields.add(new AutodateField({ name: "created", onCreate: true }))
  s.addIndex("idx_sessions_user", false, "user, revoked", "")
  app.save(s)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("sessions")) } catch (_) { /* нет */ }
  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("twoFactor")
  app.save(users)
})
