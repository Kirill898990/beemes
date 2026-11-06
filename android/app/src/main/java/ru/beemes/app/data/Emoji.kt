package ru.beemes.app.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Анимированные эмодзи Google Noto (лицензия CC BY 4.0) — лежат в assets/emoji/<код>.json (Lottie).
 * Список и группы — assets/emoji/index.json (его делает tools/fetch_emoji.py).
 */
object Emoji {
    @Serializable
    data class Item(val e: String, val c: String)

    @Serializable
    data class Group(val title: String, val items: List<Item>)

    var groups: List<Group> = emptyList()
        private set
    private var byChar: Map<String, String> = emptyMap()
    private var sorted: List<String> = emptyList()

    fun load(context: Context) {
        if (groups.isNotEmpty()) return
        groups = runCatching {
            Json { ignoreUnknownKeys = true }.decodeFromString<List<Group>>(
                context.assets.open("emoji/index.json").bufferedReader().use { it.readText() },
            )
        }.getOrDefault(emptyList())
        val map = mutableMapOf<String, String>()
        groups.flatMap { it.items }.forEach { map[it.e] = it.c; map[it.e.replace("️", "")] = it.c }
        byChar = map
        sorted = map.keys.sortedByDescending { it.length }
    }

    /** Код анимации для эмодзи (или null, если анимации нет). */
    fun codeOf(emoji: String): String? = byChar[emoji] ?: byChar[emoji.replace("️", "")]

    fun asset(code: String) = "emoji/$code.json"

    /** Код для эмодзи-статуса: в профиле хранится код (1f41d), но на всякий случай понимаем и сам символ. */
    fun statusCode(value: String): String? =
        value.takeIf { it.isNotBlank() }?.let { v -> if (Regex("^[0-9a-f_]+$").matches(v)) v else codeOf(v) }

    /** Символ эмодзи по коду (для статуса в профиле). */
    fun charOf(code: String): String = groups.asSequence().flatMap { it.items }.firstOrNull { it.c == code }?.e
        ?: code.split('_').mapNotNull { it.toIntOrNull(16) }.joinToString("") { String(Character.toChars(it)) }

    /** Части текста: обычный текст и анимированные эмодзи. */
    sealed interface Part {
        data class Text(val text: String) : Part
        data class Animated(val emoji: String, val code: String) : Part
    }

    fun split(text: String): List<Part> {
        if (sorted.isEmpty() || text.isEmpty()) return listOf(Part.Text(text))
        val out = mutableListOf<Part>()
        val buf = StringBuilder()
        var i = 0
        while (i < text.length) {
            val match = if (Character.isHighSurrogate(text[i]) || text[i].code >= 0x2190) sorted.firstOrNull { text.startsWith(it, i) } else null
            if (match != null) {
                if (buf.isNotEmpty()) { out += Part.Text(buf.toString()); buf.clear() }
                var len = match.length
                if (i + len < text.length && text[i + len] == '️') len++
                out += Part.Animated(text.substring(i, i + len), byChar.getValue(match))
                i += len
            } else {
                buf.append(text[i]); i++
            }
        }
        if (buf.isNotEmpty()) out += Part.Text(buf.toString())
        return out
    }

    /** Сообщение только из 1–3 анимированных эмодзи — показываем крупно, без «облачка». */
    fun bigEmoji(text: String): List<String>? {
        val parts = split(text.trim())
        if (parts.isEmpty() || parts.size > 3) return null
        return parts.map { (it as? Part.Animated)?.code ?: return null }
    }
}
