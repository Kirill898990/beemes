/// <reference path="../pb_data/types.d.ts" />

// База мессенджера beemes и правила доступа к ней.
//
// Главное: переписка зашифрована на телефонах (сквозное шифрование). Сервер хранит только
// зашифрованные сообщения и фото и не может их прочитать. У каждого человека есть пара ключей X25519:
// открытый ключ (publicKey) виден всем, а закрытый лежит на сервере только в зашифрованном паролем виде
// (encKey + keySalt) — чтобы после входа на новом телефоне снова читать свою переписку.
// Пароль на сервер не уходит: приложение отправляет вместо него производный «пароль входа».
//
// users       — профили: @имя, имя, о себе, аватар, цвет, эмодзи-статус, когда был в сети.
// chats       — личные чаты на двоих (один чат на пару людей).
// chat_state  — у каждого своё: до какого момента прочитано, без звука, скрыт ли чат.
// messages    — зашифрованные сообщения (body + nonce) и зашифрованные файлы (фото).
// blocks      — кого человек заблокировал: заблокированный не может ему писать и звонить.
// devices     — телефоны для push-уведомлений (Firebase).
// call_signals — служебные сообщения звонков. Голос и видео идут напрямую (WebRTC).
// bm_settings — ключ Firebase для уведомлений (заполняет администратор в веб-панели).
// app_releases — версии приложения для скачивания с сайта.

const SIGNED_IN = '@request.auth.id != ""'

function collection(name, fields, rules) {
  const c = new Collection({ type: "base", name })
  fields.forEach((f) => c.fields.add(f))
  Object.assign(c, rules)
  return c
}

migrate((app) => {
  // ---------- Пользователи ----------
  const users = app.findCollectionByNameOrId("users")
  users.fields.getByName("email").required = false
  users.fields.getByName("password").min = 8
  const name = users.fields.getByName("name")
  name.required = true
  name.min = 1
  name.max = 64
  users.fields.add(new TextField({ name: "username", required: true, min: 3, max: 32, pattern: "^[a-z0-9_]+$", presentable: true }))
  users.fields.add(new TextField({ name: "bio", max: 200 }))
  users.fields.removeByName("avatar")
  users.fields.add(new FileField({
    name: "avatar", maxSelect: 1, maxSize: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["160x160", "480x480"],
  }))
  users.fields.add(new TextField({ name: "accent", max: 20 }))
  users.fields.add(new TextField({ name: "statusEmoji", max: 24 }))
  users.fields.add(new TextField({ name: "publicKey", required: true, min: 40, max: 64 }))
  users.fields.add(new TextField({ name: "encKey", hidden: true, max: 200 }))
  users.fields.add(new TextField({ name: "keySalt", hidden: true, max: 64 }))
  users.fields.add(new DateField({ name: "lastSeen" }))
  users.fields.add(new BoolField({ name: "hideLastSeen" }))
  users.addIndex("idx_users_username", true, "username", "")
  users.passwordAuth.identityFields = ["username"]
  users.authToken.duration = 180 * 24 * 60 * 60
  users.listRule = SIGNED_IN
  users.viewRule = SIGNED_IN
  users.createRule = "@request.body.lastSeen:isset = false"
  // Открытый ключ после регистрации не меняется: иначе старая переписка перестанет расшифровываться,
  // а подменить ключ мог бы тот, кто украл вход.
  users.updateRule = "id = @request.auth.id && @request.body.publicKey:isset = false && @request.body.lastSeen:isset = false"
  users.deleteRule = "id = @request.auth.id"
  app.save(users)

  // ---------- Чаты ----------
  const chats = collection("chats", [
    new RelationField({ name: "members", required: true, minSelect: 2, maxSelect: 2, collectionId: users.id, cascadeDelete: true }),
    new TextField({ name: "pair", max: 40 }),
    new DateField({ name: "lastMessageAt" }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ], {
    listRule: "members.id ?= @request.auth.id",
    viewRule: "members.id ?= @request.auth.id",
    createRule: `${SIGNED_IN} && members.id ?= @request.auth.id`,
    updateRule: null,
    deleteRule: null,
  })
  chats.addIndex("idx_chats_pair", true, "pair", "")
  app.save(chats)

  const state = collection("chat_state", [
    new RelationField({ name: "chat", required: true, maxSelect: 1, collectionId: chats.id, cascadeDelete: true }),
    new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new DateField({ name: "readAt" }),
    new BoolField({ name: "muted" }),
    new BoolField({ name: "hidden" }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ], {
    // Собеседник видит, до какого момента вы прочитали (галочки «прочитано»).
    listRule: "chat.members.id ?= @request.auth.id",
    viewRule: "chat.members.id ?= @request.auth.id",
    createRule: "user = @request.auth.id && chat.members.id ?= @request.auth.id",
    updateRule: "user = @request.auth.id && @request.body.user:isset = false && @request.body.chat:isset = false",
    deleteRule: null,
  })
  state.addIndex("idx_chat_state", true, "chat, user", "")
  app.save(state)

  // ---------- Сообщения ----------
  const messages = collection("messages", [
    new RelationField({ name: "chat", required: true, maxSelect: 1, collectionId: chats.id, cascadeDelete: true }),
    new RelationField({ name: "sender", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new SelectField({ name: "kind", required: true, maxSelect: 1, values: ["text", "emoji", "photo", "call"] }),
    // Зашифрованное содержимое (base64) и одноразовое число шифра.
    new TextField({ name: "body", max: 30000 }),
    new TextField({ name: "nonce", max: 32 }),
    // Зашифрованный файл (фото). Ключ от него — внутри зашифрованного body.
    new FileField({ name: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true }),
    new DateField({ name: "editedAt" }),
    new AutodateField({ name: "created", onCreate: true }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ], {
    listRule: "chat.members.id ?= @request.auth.id",
    viewRule: "chat.members.id ?= @request.auth.id",
    createRule: `${SIGNED_IN} && sender = @request.auth.id && chat.members.id ?= @request.auth.id`,
    updateRule: "sender = @request.auth.id && @request.body.chat:isset = false && @request.body.sender:isset = false" +
      " && @request.body.kind:isset = false && @request.body.file:isset = false",
    deleteRule: "sender = @request.auth.id",
  })
  messages.addIndex("idx_messages_chat", false, "chat, created", "")
  app.save(messages)
  // Ответ на сообщение (ссылка на другое сообщение того же чата).
  messages.fields.add(new RelationField({ name: "replyTo", maxSelect: 1, collectionId: messages.id }))
  app.save(messages)
  // Последнее сообщение чата — для списка чатов (ставит сервер).
  chats.fields.add(new RelationField({ name: "lastMessage", maxSelect: 1, collectionId: messages.id }))
  app.save(chats)

  // ---------- Блокировки, телефоны, звонки ----------
  const blocks = collection("blocks", [
    new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new RelationField({ name: "blocked", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new AutodateField({ name: "created", onCreate: true }),
  ], {
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "user = @request.auth.id && blocked != @request.auth.id",
    updateRule: null,
    deleteRule: "user = @request.auth.id",
  })
  blocks.addIndex("idx_blocks", true, "user, blocked", "")
  app.save(blocks)

  const devices = collection("devices", [
    new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new TextField({ name: "token", required: true, max: 400 }),
    new TextField({ name: "platform", max: 20 }),
    new TextField({ name: "appVersion", max: 20 }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ], {
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id && @request.body.user:isset = false",
    deleteRule: "user = @request.auth.id",
  })
  devices.addIndex("idx_devices_token", true, "token", "")
  app.save(devices)

  const signals = collection("call_signals", [
    new TextField({ name: "call", required: true, max: 30, pattern: "^[a-z0-9]+$" }),
    new RelationField({ name: "from", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new RelationField({ name: "to", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }),
    new RelationField({ name: "chat", required: true, maxSelect: 1, collectionId: chats.id, cascadeDelete: true }),
    new SelectField({ name: "type", required: true, maxSelect: 1, values: ["ring", "accept", "decline", "busy", "offer", "answer", "hangup"] }),
    new JSONField({ name: "data", maxSize: 60000 }),
    new AutodateField({ name: "created", onCreate: true }),
  ], {
    listRule: "from = @request.auth.id || to = @request.auth.id",
    viewRule: "from = @request.auth.id || to = @request.auth.id",
    // Что второй участник звонка — собеседник по этому чату, проверяет сервер (pb_hooks/calls.pb.js).
    createRule: `${SIGNED_IN} && from = @request.auth.id && to != @request.auth.id && chat.members.id ?= @request.auth.id`,
    updateRule: null,
    deleteRule: null,
  })
  signals.addIndex("idx_call_signals_to", false, "to, created", "")
  signals.addIndex("idx_call_signals_call", false, "call, created", "")
  app.save(signals)

  // ---------- Настройки и версии приложения ----------
  app.save(collection("bm_settings", [
    // JSON-ключ сервисного аккаунта Firebase (Firebase → Настройки проекта → Сервисные аккаунты → Создать ключ).
    new JSONField({ name: "firebaseKey", maxSize: 10000 }),
    new URLField({ name: "fcmUrl" }),
    new URLField({ name: "tokenUrl" }),
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
  ], { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null }))

  const releases = collection("app_releases", [
    new NumberField({ name: "versionCode", required: true, min: 1, onlyInt: true }),
    new TextField({ name: "versionName", required: true, max: 20 }),
    new TextField({ name: "notes", max: 2000 }),
    new FileField({ name: "apk", required: true, maxSelect: 1, maxSize: 150 * 1024 * 1024 }),
    new AutodateField({ name: "created", onCreate: true }),
  ], { listRule: "", viewRule: "", createRule: null, updateRule: null, deleteRule: null })
  releases.addIndex("idx_app_releases_code", true, "versionCode", "")
  app.save(releases)

  // Защита от перебора паролей и потока запросов (лимиты на один IP-адрес).
  const settings = app.settings()
  settings.meta.appName = "beemes"
  settings.rateLimits.enabled = true
  settings.rateLimits.rules = [
    { label: "*:auth", maxRequests: 30, duration: 60, audience: "" },
    { label: "users:create", maxRequests: 10, duration: 600, audience: "@guest" },
    { label: "messages:create", maxRequests: 60, duration: 10, audience: "" },
    { label: "*:create", maxRequests: 60, duration: 10, audience: "" },
    { label: "/api/batch", maxRequests: 5, duration: 1, audience: "" },
    { label: "/api/", maxRequests: 300, duration: 10, audience: "@guest" },
    { label: "/api/", maxRequests: 1200, duration: 10, audience: "@auth" },
  ]
  settings.backups.cron = "0 1 * * *"
  settings.backups.cronMaxKeep = 7
  app.save(settings)
}, (app) => {
  for (const n of ["app_releases", "bm_settings", "call_signals", "devices", "blocks", "messages", "chat_state", "chats"]) {
    try { app.delete(app.findCollectionByNameOrId(n)) } catch (_) {}
  }
})
