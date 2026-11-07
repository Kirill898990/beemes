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
)

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
)

@Serializable
data class ChatState(
    val id: String = "",
    val chat: String = "",
    val user: String = "",
    val readAt: String = "",
    val muted: Boolean = false,
    val hidden: Boolean = false,
)

@Serializable
data class Block(val id: String = "", val user: String = "", val blocked: String = "")

@Serializable
data class Page<T>(val page: Int = 1, val totalPages: Int = 1, val totalItems: Int = -1, val items: List<T> = emptyList())

@Serializable
data class AuthResponse(val token: String = "", val record: User = User())

@Serializable
data class Keys(val publicKey: String = "", val encKey: String = "", val keySalt: String = "")

@Serializable
data class UnreadResponse(val unread: Map<String, Int> = emptyMap())

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
