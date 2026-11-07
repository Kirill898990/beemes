package ru.beemes.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Стикеры beemes (наборы в assets/stickers, те же, что на сайте; рисует tools/stickers/make_stickers.py). */
object Stickers {
    @Serializable data class Item(val id: String, val e: String, val t: String = "")
    @Serializable data class Pack(val id: String, val title: String, val items: List<Item>)

    var packs: List<Pack> = emptyList()
        private set
    private val cache = LruCache<String, Bitmap>(24)

    fun load(context: Context) {
        if (packs.isNotEmpty()) return
        packs = runCatching {
            Json { ignoreUnknownKeys = true }.decodeFromString<List<Pack>>(context.assets.open("stickers/index.json").bufferedReader().use { it.readText() })
        }.getOrDefault(emptyList())
    }

    /** Картинка стикера «набор/имя» (null — такого нет: показываем его эмодзи). */
    fun image(context: Context, st: String?): Bitmap? {
        if (st == null || !Regex("^[a-z0-9]+/[a-z0-9]+$").matches(st)) return null
        val (pack, id) = st.split("/")
        if (packs.none { p -> p.id == pack && p.items.any { it.id == id } }) return null
        cache.get(st)?.let { return it }
        return runCatching { context.assets.open("stickers/$pack/$id.png").use { BitmapFactory.decodeStream(it) } }.getOrNull()?.also { cache.put(st, it) }
    }
}
