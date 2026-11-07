package ru.beemes.app.data

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/* Данные с сервера beemes. Названия полей совпадают с базой (server/pb_migrations). */

@Serializable
data class User(
    val id: String = "",
    val username: String = "",
    val name: String = "",
    val bio: String = "",
    val avatar: String = "",
    val accent: String = "",
    val statusEmoji: String = "",
    /** Почта (видна только самому человеку), подтверждена ли, включена ли 2FA. */
    val email: String = "",
    val verified: Boolean = false,
    val twoFactor: Boolean = false,
    /** Галочка: аккаунт подтверждён (выдаёт администратор beemes). */
    val badge: Boolean = false,
    /** Узор из эмодзи на фоне шапки профиля (код Noto). */
    val bgEmoji: String = "",
    val publicKey: String = "",
    val lastSeen: String = "",
    /** «В сети» до этого момента: приложение сообщает серверу, когда его открыли и когда свернули. */
    val onlineUntil: String = "",
    val hideLastSeen: Boolean = false,
    val created: String = "",
) {
    val title: String get() = name.ifBlank { "@$username" }
    val lastSeenInstant: Instant? get() = parseTime(lastSeen)
    val onlineUntilMillis: Long get() = parseTime(onlineUntil)?.toEpochMilli() ?: 0L
    /** В сети прямо сейчас (now — для экранов, которые перерисовываются по часам «в сети»). */
    fun onlineAt(now: Long): Boolean =
        if (onlineUntil.isNotBlank()) onlineUntilMillis > now
        else lastSeenInstant?.let { now - it.toEpochMilli() < 120_000 } == true
    val online: Boolean get() = onlineAt(System.currentTimeMillis())
}

/**
 * Часы для «в сети»: тикают, когда у кого-то истекает «в сети» (пропал без «до свидания» — сел телефон),
 * и раз в полминуты. Экраны читают их, чтобы точка и «был(а) N мин. назад» обновлялись сами.
 */
object PresenceClock {
    val now = kotlinx.coroutines.flow.MutableStateFlow(System.currentTimeMillis())
}

@Serializable
data class MessageRecord(
    val id: String = "",
    val chat: String = "",
    val sender: String = "",
    val kind: String = "text",
    val body: String = "",
    val nonce: String = "",
    val file: String = "",
    val replyTo: String = "",
    val editedAt: String = "",
    val created: String = "",
    /** Эпоха ключа группы (0 — личный чат или публичный канал). */
    val epoch: Int = 0,
)

/** Ключ группы, зашифрованный лично для меня (chat_keys). */
@Serializable
data class ChatKey(val id: String = "", val chat: String = "", val user: String = "", val epoch: Int = 0, val from: String = "", val body: String = "", val nonce: String = "")

/** Группа/канал до вступления (приглашение, поиск). */
@Serializable
data class GroupPreview(
    val id: String = "", val type: String = "", val title: String = "", val about: String = "", val photo: String = "",
    val isPublic: Boolean = false, val handle: String = "", val membersCount: Int = 0, val joined: Boolean = false,
    val badge: Boolean = false,
)

/** Строка админ-панели: человек (kind = "user") или канал/группа (kind = "chat"). */
@Serializable
data class AdminRow(
    val kind: String = "", val id: String = "", val badge: Boolean = false,
    val name: String = "", val username: String = "", val avatar: String = "", val accent: String = "",
    val type: String = "", val title: String = "", val handle: String = "", val photo: String = "", val isPublic: Boolean = false, val membersCount: Int = 0,
) {
    val user: User get() = User(id = id, name = name, username = username, avatar = avatar, accent = accent, badge = badge)
}

@Serializable
data class AdminList(val items: List<AdminRow> = emptyList())

@Serializable
data class AdminMe(val admin: Boolean = false)

/** Какие способы входа работают на сервере (почта настроена, SMS подключены). */
@Serializable
data class AuthOptions(val email: Boolean = false, val phone: Boolean = false)

/** Код отправлен: kind — "email" или "phone", to — куда (со звёздочками). */
@Serializable
data class CodeSent(val sent: Boolean = false, val kind: String = "", val to: String = "")

/** Вход по почте/телефону: код верный → чей аккаунт и пропуск на 10 минут (дальше — пароль). */
@Serializable
data class LoginFound(val username: String = "", val name: String = "", val ticket: String = "")

/** Почта и телефон (телефон видит только сам человек). */
@Serializable
data class ContactInfo(val email: String = "", val verified: Boolean = false, val phone: String = "")

/** Участник группы (для «О группе»). */
@Serializable
data class GroupMember(
    val id: String = "", val username: String = "", val name: String = "", val avatar: String = "", val accent: String = "",
    val statusEmoji: String = "", val publicKey: String = "", val admin: Boolean = false, val owner: Boolean = false, val hasKey: Boolean = false,
) {
    fun toUser() = User(id = id, username = username, name = name, avatar = avatar, accent = accent, statusEmoji = statusEmoji, publicKey = publicKey)
}

@Serializable
data class ChatExpand(val members: List<User> = emptyList(), val lastMessage: MessageRecord? = null)

@Serializable
data class Chat(
    val id: String = "",
    val members: List<String> = emptyList(),
    val lastMessageAt: String = "",
    val lastMessage: String = "",
    val created: String = "",
    val expand: ChatExpand? = null,
    // Группы и каналы (у личного чата type пустой)
    val type: String = "",
    val title: String = "",
    val about: String = "",
    val photo: String = "",
    val owner: String = "",
    val admins: List<String> = emptyList(),
    val isPublic: Boolean = false,
    val handle: String = "",
    val inviteCode: String = "",
    val openKey: String = "",
    val keyEpoch: Int = 0,
    val membersCount: Int = 0,
    /** Галочка: канал или группа подтверждены. */
    val badge: Boolean = false,
    /** Я в группе (сервер отвечает для групп; у личного чата не важно). */
    val joined: Boolean = true,
) {
    val isGroup: Boolean get() = type.isNotBlank()
    val isChannel: Boolean get() = type == "channel"
    /** Эпоха, которой шифруются новые сообщения. */
    val sendEpoch: Int get() = if (isPublic) 0 else keyEpoch
    fun isAdmin(userId: String) = owner == userId || userId in admins
    /** «3 участника», «канал · 120 подписчиков». */
    val subtitle: String get() {
        val n = if (membersCount > 0) membersCount else members.size
        return if (isChannel) "${if (isPublic) "публичный канал" else "канал"} · $n ${plural(n, "подписчик", "подписчика", "подписчиков")}"
        else "$n ${plural(n, "участник", "участника", "участников")}"
    }
}

fun plural(n: Int, one: String, few: String, many: String) =
    if (n % 10 == 1 && n % 100 != 11) one else if (n % 10 in 2..4 && (n % 100 < 12 || n % 100 > 14)) few else many

@Serializable
data class ChatState(
    val id: String = "",
    val chat: String = "",
    val user: String = "",
    val readAt: String = "",
    val muted: Boolean = false,
    val hidden: Boolean = false,
    /** Фон чата (личный): "" — соты, "p:<имя>" — готовый, "photo:<nonce>.<шифр>" — своё фото. */
    val wallpaper: String = "",
    val wallpaperFile: String = "",
)

@Serializable
data class Block(val id: String = "", val user: String = "", val blocked: String = "")

@Serializable
data class Page<T>(val page: Int = 1, val totalPages: Int = 1, val totalItems: Int = -1, val items: List<T> = emptyList())

@Serializable
data class AuthResponse(val token: String = "", val record: User = User(), val meta: AuthMeta? = null)

@Serializable
data class SessionSecret(val id: String = "", val secret: String = "")

@Serializable
data class AuthMeta(val session: SessionSecret? = null, val email: String? = null, val qr: QrPayload? = null)

/** Ключ переписки, зашифрованный телефоном для временного ключа из QR. */
@Serializable
data class QrPayload(val e2pub: String = "", val body: String = "", val nonce: String = "")

@Serializable
data class QrStart(val id: String = "", val secret: String = "", val expiresIn: Int = 180)

/** Ответ «ждём подтверждения» ({status}) или вход ({token, record, meta}). */
@Serializable
data class QrPoll(val status: String = "", val token: String = "", val record: User = User(), val meta: AuthMeta? = null)

/** Устройство, где вы вошли (Настройки → Устройства). */
@Serializable
data class DeviceSession(
    val id: String = "", val name: String = "", val platform: String = "", val ip: String = "", val how: String = "",
    val created: String = "", val lastActive: String = "", val current: Boolean = false,
)

@Serializable
data class DeviceList(val items: List<DeviceSession> = emptyList())

@Serializable
data class Ended(val ended: Int = 0)

@Serializable
data class EmailSent(val sent: Boolean = false, val to: String = "")

/** QR-код нового устройства: id входа и его временный открытый ключ (base64url). */
data class QrLink(val id: String, val pub: String)

@Serializable
data class QrInfo(val name: String = "", val platform: String = "", val ip: String = "", val status: String = "")

@Serializable
data class Keys(val publicKey: String = "", val encKey: String = "", val keySalt: String = "")

@Serializable
data class UnreadResponse(val unread: Map<String, Int> = emptyMap())

@Serializable
data class PostsResponse(val items: List<MessageRecord> = emptyList(), val more: Boolean = false)

@Serializable
data class UsernameCheck(val free: Boolean = false, val reason: String = "")

@Serializable
data class FileToken(val token: String = "")

@Serializable
data class Incoming(val id: String = "", val chat: String = "", val from: String = "", val name: String = "", val video: Boolean = false)

@Serializable
data class IncomingResponse(val call: Incoming? = null)

@Serializable
data class AppRelease(val id: String = "", val versionCode: Int = 0, val versionName: String = "", val notes: String = "", val apk: String = "")

/**
 * Что внутри зашифрованного сообщения (короткие имена — чтобы шифр был короче).
 * t — текст; k, w, h, p, c — фото (ключ файла, размеры, крошечное превью, подпись);
 * v, d, s — звонок (видео ли, длительность в секундах, итог: done / missed / declined).
 */
@Serializable
data class Content(
    val t: String? = null,
    val k: String? = null,
    val w: Int? = null,
    val h: Int? = null,
    val p: String? = null,
    val c: String? = null,
    val v: Boolean? = null,
    val d: Int? = null,
    val s: String? = null,
    /** Стикер: «набор/имя» и его эмодзи. */
    val st: String? = null,
    val e: String? = null,
)

enum class SendStatus { SENDING, SENT, READ, FAILED }

/** Расшифрованное сообщение для экрана. content == null — не удалось расшифровать. */
data class Msg(
    val id: String,
    val chatId: String,
    val senderId: String,
    val kind: String,
    val content: Content?,
    val created: Instant,
    val edited: Boolean = false,
    val file: String = "",
    val replyTo: String = "",
    val epoch: Int = 0,
    val status: SendStatus = SendStatus.SENT,
    /** Для неотправленных: локальный id, чтобы заменить на настоящий. */
    val localId: String = "",
    val error: String? = null,
) {
    val text: String get() = content?.t.orEmpty()

    /** Короткое описание для списка чатов и уведомлений. */
    fun preview(): String = when {
        content == null -> "🔒 Сообщение"
        kind == "photo" -> "📷 " + (content.c?.takeIf { it.isNotBlank() } ?: "Фото")
        kind == "call" -> callTitle(mine = false)
        kind == "sticker" -> listOfNotNull(content.e, "Стикер").joinToString(" ")
        else -> text.replace('\n', ' ')
    }

    fun callTitle(mine: Boolean): String {
        val video = content?.v == true
        return when (content?.s) {
            "missed" -> if (mine) "Отменённый звонок" else "Пропущенный звонок"
            "declined" -> "Звонок отклонён"
            else -> (if (video) "Видеозвонок" else "Звонок") + (content?.d?.takeIf { it > 0 }?.let { " · " + duration(it) } ?: "")
        }
    }
}

/** Строка в списке чатов. */
data class ChatItem(
    val chat: Chat,
    val peer: User,
    val last: Msg?,
    val unread: Int,
    val muted: Boolean,
    val hidden: Boolean,
    /** Собеседник прочитал до этого момента (галочки «прочитано»). */
    val peerReadAt: Instant?,
)

// ---------- Время ----------

fun parseTime(value: String): Instant? =
    if (value.isBlank()) null else runCatching { Instant.parse(value.trim().replace(' ', 'T')) }.getOrNull()

fun serverTime(instant: Instant): String = instant.toString().replace('T', ' ').let { if (it.contains('.')) it else it.replace("Z", ".000Z") }

private val ru = Locale.forLanguageTag("ru")

fun timeOfDay(instant: Instant): String = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(instant)

/** Для списка чатов: время сегодня, «вчера», день недели или дата. */
fun shortWhen(instant: Instant): String {
    val zone = ZoneId.systemDefault()
    val day = instant.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when {
        day == today -> timeOfDay(instant)
        day == today.minusDays(1) -> "вчера"
        day.isAfter(today.minusDays(7)) -> DateTimeFormatter.ofPattern("EE", ru).format(day)
        day.year == today.year -> DateTimeFormatter.ofPattern("d MMM", ru).format(day).trimEnd('.')
        else -> DateTimeFormatter.ofPattern("dd.MM.yy").format(day)
    }
}

/** Плашка даты в переписке: «Сегодня», «Вчера», «5 ноября». */
fun dayTitle(instant: Instant): String {
    val zone = ZoneId.systemDefault()
    val day = instant.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when (day) {
        today -> "Сегодня"
        today.minusDays(1) -> "Вчера"
        else -> DateTimeFormatter.ofPattern(if (day.year == today.year) "d MMMM" else "d MMMM yyyy", ru).format(day)
    }
}

/** «в сети», «был(а) 5 минут назад», «был(а) вчера в 21:40». */
fun lastSeenText(user: User, now: Long = System.currentTimeMillis()): String {
    if (user.onlineAt(now)) return "в сети"
    val t = user.lastSeenInstant ?: return if (user.hideLastSeen) "был(а) недавно" else "был(а) давно"
    val minutes = (now / 1000 - t.epochSecond) / 60
    return when {
        minutes < 1 -> "был(а) только что"
        minutes < 60 -> "был(а) $minutes мин. назад"
        else -> {
            val zone = ZoneId.systemDefault()
            val day = t.atZone(zone).toLocalDate()
            val today = LocalDate.now(zone)
            when (day) {
                today -> "был(а) в ${timeOfDay(t)}"
                today.minusDays(1) -> "был(а) вчера в ${timeOfDay(t)}"
                else -> "был(а) ${DateTimeFormatter.ofPattern("d MMMM", ru).format(day)}"
            }
        }
    }
}

fun duration(seconds: Int): String = "%d:%02d".format(seconds / 60, seconds % 60)
