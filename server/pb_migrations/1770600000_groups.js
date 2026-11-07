/// <reference path="../pb_data/types.d.ts" />
// Группы и каналы.
//
// chats.type: "" — личный чат (как раньше), "group" — группа (пишут все), "channel" — канал (пишут админы).
// Приватные группы и каналы зашифрованы общим ключом (32 байта), у которого есть номер — эпоха (keyEpoch).
// Сервер ключа не знает: каждому участнику ключ передаётся зашифрованным лично для него (chat_keys),
// а в ссылке-приглашении он лежит после «#» — эта часть адреса на сервер не уходит.
// Публичный канал (isPublic) виден всем и находится поиском по @имени (handle): его ключ лежит открыто (openKey).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const chats = app.findCollectionByNameOrId("chats")
  const members = chats.fields.getByName("members")
  members.minSelect = 1
  members.maxSelect = 20000
  chats.fields.add(new SelectField({ name: "type", maxSelect: 1, values: ["group", "channel"] }))
  chats.fields.add(new TextField({ name: "title", max: 64 }))
  chats.fields.add(new TextField({ name: "about", max: 255 }))
  chats.fields.add(new FileField({ name: "photo", maxSelect: 1, maxSize: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["160x160", "480x480"] }))
  chats.fields.add(new RelationField({ name: "owner", maxSelect: 1, collectionId: users.id }))
  chats.fields.add(new RelationField({ name: "admins", maxSelect: 50, collectionId: users.id }))
  chats.fields.add(new BoolField({ name: "isPublic" }))
  chats.fields.add(new TextField({ name: "handle", max: 32, pattern: "^[a-z0-9_]*$" }))
  chats.fields.add(new TextField({ name: "inviteCode", max: 32 }))
  chats.fields.add(new TextField({ name: "openKey", max: 64 }))
  chats.fields.add(new NumberField({ name: "keyEpoch", onlyInt: true }))
  chats.fields.add(new NumberField({ name: "membersCount", onlyInt: true }))
  // У групп нет «пары» — уникальность только для личных чатов.
  chats.removeIndex("idx_chats_pair")
  chats.addIndex("idx_chats_pair", true, "pair", "pair != ''")
  chats.addIndex("idx_chats_handle", true, "handle", "handle != ''")
  chats.addIndex("idx_chats_invite", true, "inviteCode", "inviteCode != ''")
  // Список (и обновления в реальном времени) — только свои чаты. Публичный канал можно открыть по id,
  // чтобы посмотреть до подписки (поиск — /api/bm/channels).
  chats.listRule = "members.id ?= @request.auth.id"
  chats.viewRule = "members.id ?= @request.auth.id || (isPublic = true && @request.auth.id != '')"
  // Название, описание, фото, @имя — меняют админы. Участников, админов и ключи — только через /api/bm/groups.
  chats.updateRule = "type != '' && admins.id ?= @request.auth.id" + [
    "members", "owner", "admins", "type", "isPublic", "inviteCode", "openKey", "keyEpoch", "membersCount", "pair", "lastMessage", "lastMessageAt",
  ].map((f) => ` && @request.body.${f}:isset = false`).join("")
  app.save(chats)

  const messages = app.findCollectionByNameOrId("messages")
  messages.fields.add(new NumberField({ name: "epoch", onlyInt: true }))
  // Список и реальное время — только участникам; отдельное сообщение (и фото в нём) публичного канала
  // доступно всем вошедшим: посты до подписки отдаёт /api/bm/channels/{id}/posts.
  messages.listRule = "chat.members.id ?= @request.auth.id"
  messages.viewRule = "chat.members.id ?= @request.auth.id || (chat.isPublic = true && @request.auth.id != '')"
  // Удалить сообщение может автор, а в группе и канале — ещё и админ.
  messages.deleteRule = "sender = @request.auth.id || chat.admins.id ?= @request.auth.id"
  app.save(messages)

  // «Прочитано» в каналах не показываем — подписчикам не нужно видеть друг друга.
  const state = app.findCollectionByNameOrId("chat_state")
  state.listRule = "user = @request.auth.id || (chat.type != 'channel' && chat.members.id ?= @request.auth.id)"
  state.viewRule = state.listRule
  app.save(state)

  // Ключ группы, зашифрованный лично для участника: X25519(from, user) → HKDF → AES-GCM.
  const keys = new Collection({
    type: "base",
    name: "chat_keys",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != '' && from = @request.auth.id && chat.members.id ?= @request.auth.id",
    updateRule: null,
    deleteRule: null,
  })
  keys.fields.add(new RelationField({ name: "chat", required: true, maxSelect: 1, collectionId: chats.id, cascadeDelete: true }))
  keys.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  keys.fields.add(new NumberField({ name: "epoch", onlyInt: true, min: 1 }))
  keys.fields.add(new RelationField({ name: "from", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true }))
  keys.fields.add(new TextField({ name: "body", required: true, max: 200 }))
  keys.fields.add(new TextField({ name: "nonce", required: true, max: 32 }))
  keys.fields.add(new AutodateField({ name: "created", onCreate: true }))
  keys.addIndex("idx_chat_keys", true, "chat, user, epoch", "")
  app.save(keys)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("chat_keys")) } catch (_) { /* нет */ }
  const chats = app.findCollectionByNameOrId("chats")
  for (const f of ["type", "title", "about", "photo", "owner", "admins", "isPublic", "handle", "inviteCode", "openKey", "keyEpoch", "membersCount"]) chats.fields.removeByName(f)
  chats.removeIndex("idx_chats_handle")
  chats.removeIndex("idx_chats_invite")
  app.save(chats)
  const messages = app.findCollectionByNameOrId("messages")
  messages.fields.removeByName("epoch")
  app.save(messages)
})
