// Группы и каналы: общие проверки (см. groups.pb.js и миграцию 1770600000_groups.js).

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

function newInviteCode() {
  return $security.randomStringWithAlphabet(14, ALPHABET)
}

const isGroup = (chat) => !!chat.getString("type")
const memberIds = (chat) => chat.getStringSlice("members")
const isMember = (chat, uid) => memberIds(chat).indexOf(uid) >= 0
const isOwner = (chat, uid) => chat.getString("owner") === uid
const isAdmin = (chat, uid) => isOwner(chat, uid) || chat.getStringSlice("admins").indexOf(uid) >= 0

/** Группа/канал по id; только если это группа и человек в ней (или канал публичный — для просмотра). */
function loadGroup(app, id, uid, needMember) {
  let chat = null
  try { chat = app.findRecordById("chats", id) } catch (_) {}
  if (!chat || !isGroup(chat)) throw new NotFoundError("Группа не найдена")
  if (needMember !== false && !isMember(chat, uid)) throw new ForbiddenError("Вы не участник")
  return chat
}

function setMembers(chat, ids) {
  const uniq = []
  ids.forEach((id) => { if (id && uniq.indexOf(id) < 0) uniq.push(id) })
  chat.set("members", uniq)
  chat.set("membersCount", uniq.length)
  // админы — только из участников
  chat.set("admins", chat.getStringSlice("admins").filter((a) => uniq.indexOf(a) >= 0))
  return uniq
}

/** @имя публичного канала: как у людей (латиница, цифры, _), не занято ни человеком, ни другим каналом. */
function checkHandle(app, handle, exceptChat) {
  const { RESERVED } = require(`${__hooks}/lib.js`)
  const h = String(handle || "").trim().toLowerCase().replace(/^@/, "")
  if (!/^[a-z0-9_]{4,32}$/.test(h)) throw new BadRequestError("@имя канала: от 4 до 32 латинских букв, цифр или _")
  let taken = RESERVED.indexOf(h) >= 0
  try { app.findFirstRecordByFilter("users", "username = {:h}", { h }); taken = true } catch (_) { /* свободно */ }
  try {
    const other = app.findFirstRecordByFilter("chats", "handle = {:h}", { h })
    if (!exceptChat || other.id !== exceptChat) taken = true
  } catch (_) { /* свободно */ }
  if (taken) throw new BadRequestError("Это @имя занято")
  return h
}

/** Краткое описание для приглашения и поиска (без участников и ключей). */
function preview(app, chat, uid) {
  return {
    id: chat.id, type: chat.getString("type"), title: chat.getString("title"), about: chat.getString("about"),
    photo: chat.getString("photo"), isPublic: chat.getBool("isPublic"), handle: chat.getString("handle"),
    membersCount: chat.getInt("membersCount"), joined: isMember(chat, uid), badge: chat.getBool("badge"),
  }
}

module.exports = { newInviteCode, isGroup, memberIds, isMember, isOwner, isAdmin, loadGroup, setMembers, checkHandle, preview }
