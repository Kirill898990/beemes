package ru.beemes.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

/**
 * Новое — сразу, без обновления экрана: PocketBase присылает события (Server-Sent Events), пока приложение открыто.
 * Сервер сам проверяет права: приходят только свои чаты, сообщения и звонки.
 */
class Realtime(private val repo: Repository, private val context: android.content.Context) {
    @Serializable private data class Connect(val clientId: String = "")
    @Serializable private data class MessageEvent(val action: String = "", val record: MessageRecord = MessageRecord())
    @Serializable private data class StateEvent(val action: String = "", val record: ChatState = ChatState())
    @Serializable data class SignalRecord(
        val id: String = "", val call: String = "", val from: String = "", val to: String = "", val chat: String = "", val type: String = "", val created: String = "",
        val data: kotlinx.serialization.json.JsonElement? = null,
    ) {
        private fun field(name: String) = ((data as? kotlinx.serialization.json.JsonObject)?.get(name) as? kotlinx.serialization.json.JsonPrimitive)
        val video: Boolean get() = field("video")?.content == "true"
        val name: String get() = field("name")?.takeIf { it.isString }?.content.orEmpty()
    }
    @Serializable private data class SignalEvent(val action: String = "", val record: SignalRecord = SignalRecord())
    @Serializable private data class UserEvent(val action: String = "", val record: User = User())

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var source: EventSource? = null
    private var retryJob: Job? = null
    @Volatile private var wanted = false

    private val _rings = MutableSharedFlow<SignalRecord>(extraBufferCapacity = 8)
    /** Звонки, пока приложение открыто: ring — звонят, accept/decline/hangup — звонок закончился. */
    val signals: SharedFlow<SignalRecord> = _rings

    @Volatile private var clientId = ""
    @Volatile private var lastTopics = ""
    private var peersJob: Job? = null
    private var subscribeRetry: Job? = null
    /** Когда соединение последний раз подавало признаки жизни (открылось или пришло событие). */
    @Volatile private var aliveAt = 0L

    // Сменилась сеть (Wi-Fi ↔ мобильный интернет) — старое соединение «зависает» молча: подключаемся заново.
    private val connectivity = context.getSystemService(android.net.ConnectivityManager::class.java)
    @Volatile private var network: android.net.Network? = null
    private val networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: android.net.Network) {
            val changed = network != null && network != n
            network = n
            if (changed && wanted) restart()
        }
    }
    private var watching = false

    fun start() {
        wanted = true
        if (!watching) {
            watching = runCatching { connectivity?.registerDefaultNetworkCallback(networkCallback) }.isSuccess && connectivity != null
        }
        if (source == null) connect()
        // Новые собеседники — следим и за их «в сети».
        if (peersJob?.isActive != true) peersJob = scope.launch {
            repo.chats.collect { resubscribe() }
        }
    }

    private fun topics() = listOf("messages", "chat_state", "chats", "call_signals") + repo.peerIds().map { "users/$it" }

    /** Собеседники, за которыми уже следим: у новых (появились в списке) берём свежий «в сети». */
    private val knownPeers = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /** Подписка: свои чаты, сообщения, звонки и «в сети» каждого собеседника (users/<id>). */
    private suspend fun resubscribe() {
        val id = clientId
        if (id.isBlank()) return
        val t = topics()
        val key = id + "|" + t.joinToString(",")
        if (key == lastTopics) return
        lastTopics = key
        val peers = repo.peerIds()
        if (knownPeers.isNotEmpty()) peers.filter { it !in knownPeers }.forEach { repo.refreshPresence(it) }
        knownPeers.addAll(peers)
        val body = buildJsonObject {
            put("clientId", id)
            put("subscriptions", JsonArray(t.map { JsonPrimitive(it) }))
        }
        runCatching {
            // Своя подписка сервера beemes: обычная (api/realtime) отказывает, если адрес сменился
            // (мобильный интернет, Wi-Fi ↔ LTE) — соединение открыто, а событий нет.
            try {
                repo.api.sendRaw("POST", "api/bm/realtime", body)
            } catch (e: ApiException) {
                // старый сервер без этой подписки
                if (e.status == 404) repo.api.sendRaw("POST", "api/realtime", body) else throw e
            }
        }.onSuccess { subscribeFails = 0 }.onFailure {
            // Без подписки соединение открыто, но события не идут — повторяем, а не ждём следующего обновления чатов.
            lastTopics = ""
            if (++subscribeFails >= 3) { subscribeFails = 0; restart() }
            else { subscribeRetry?.cancel(); subscribeRetry = scope.launch { delay(2000L * subscribeFails); resubscribe() } }
        }
    }
    @Volatile private var subscribeFails = 0

    // ---------- Проверка, что события правда доходят ----------
    // Раз в 20 секунд (вместе с «я в сети») просим сервер прислать отметку в наш поток. Не пришла за 8 секунд —
    // поток кто-то «придерживает» (антивирус, прокси, плохая сеть): переподключаемся, а если не помогло —
    // опрашиваем сервер каждые 4 секунды, пока отметки снова не начнут доходить.
    @Volatile private var startedAt = 0L
    @Volatile private var pingN = 0L
    @Volatile private var pongN = 0L
    @Volatile private var misses = 0
    @Volatile private var pingOff = false
    private var pollJob: Job? = null

    /** Соединение живо? Зовётся раз в 20 секунд, пока приложение на экране. */
    fun checkAlive() {
        if (!wanted) return
        val now = System.currentTimeMillis()
        if (source == null && retryJob?.isActive != true) { connect(); return }
        // PocketBase закрывает молчащее соединение через 5 минут — если и этого не было, связь «зависла»
        if (aliveAt > 0 && now - aliveAt > 330_000) { restart(); return }
        if (pingOff) return
        val id = clientId
        // соединение так и не открылось (даже первое событие не дошло) — тоже пропуск
        if (id.isBlank()) { if (now - startedAt > 12_000) missed(); return }
        val n = ++pingN
        scope.launch {
            try {
                repo.api.sendRaw("POST", "api/bm/realtime/ping", buildJsonObject { put("clientId", id); put("n", n) })
            } catch (e: ApiException) {
                if (e.status == 404) pingOff = true // старый сервер без проверки
                return@launch
            } catch (_: Exception) { return@launch }
            delay(8000)
            if (pongN < n && id == clientId) missed()
        }
    }

    private fun missed() {
        misses++
        if (misses == 1) restart() else startPolling()
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) return
        android.util.Log.w("beemes", "События не доходят — обновляю опросом сервера")
        pollJob = scope.launch {
            while (wanted) {
                runCatching { repo.refreshChats() }
                repo.openChatId?.let { runCatching { repo.loadMessages(it) } }
                delay(4000)
            }
        }
    }

    private fun stopPolling() { pollJob?.cancel(); pollJob = null }

    /** Подключиться заново (и забрать всё, что пришло, пока связи не было). */
    fun restart() {
        if (!wanted) return
        retryJob?.cancel()
        subscribeRetry?.cancel()
        clientId = ""
        lastTopics = ""
        val old = source
        source = null
        old?.cancel()
        connect()
    }

    fun stop() {
        wanted = false
        stopPolling()
        clientId = ""
        lastTopics = ""
        peersJob?.cancel()
        retryJob?.cancel()
        subscribeRetry?.cancel()
        val old = source
        source = null
        old?.cancel()
        if (watching) { runCatching { connectivity?.unregisterNetworkCallback(networkCallback) }; watching = false; network = null }
    }

    // Молчит дольше 5,5 минуты (сервер сам закрывает тихое соединение через 5) — значит, связь оборвалась незаметно.
    private val sseClient by lazy { repo.api.client.newBuilder().readTimeout(330, TimeUnit.SECONDS).build() }

    @Synchronized private fun connect() {
        if (source != null) return
        aliveAt = System.currentTimeMillis()
        startedAt = aliveAt
        val request = Request.Builder().url(repo.api.url("api/realtime")).build()
        source = EventSources.createFactory(sseClient).newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                if (eventSource === source) aliveAt = System.currentTimeMillis()
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (eventSource !== source) return
                aliveAt = System.currentTimeMillis()
                runCatching { handle(type.orEmpty(), data) }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                // Старое соединение (после restart) — не трогаем новое.
                if (eventSource !== source) return
                source = null
                clientId = ""
                if (wanted) {
                    retryJob?.cancel()
                    retryJob = scope.launch { delay(3000); if (wanted && source == null) connect() }
                }
            }

            override fun onClosed(eventSource: EventSource) = onFailure(eventSource, null, null)
        })
    }

    private fun handle(type: String, data: String) {
        val json = repo.api.json
        when (type) {
            "PB_CONNECT" -> {
                clientId = json.decodeFromString(Connect.serializer(), data).clientId
                lastTopics = ""
                scope.launch {
                    resubscribe()
                    // Пока не было связи, могло что-то прийти.
                    runCatching { repo.refreshChats() }
                    repo.openChatId?.let { runCatching { repo.loadMessages(it) } }
                }
            }
            "messages" -> {
                val e = json.decodeFromString(MessageEvent.serializer(), data)
                if (e.action == "delete") repo.removeMessage(e.record.chat, e.record.id) else repo.applyRecord(e.record)
            }
            "chat_state" -> repo.applyState(json.decodeFromString(StateEvent.serializer(), data).record)
            "chats" -> scope.launch { runCatching { repo.refreshChats() } }
            // ответ на проверку живости потока
            "bm_ping" -> {
                pongN = maxOf(pongN, runCatching { json.parseToJsonElement(data).jsonObject["n"]?.jsonPrimitive?.content?.toLong() }.getOrNull() ?: 0L)
                misses = 0
                stopPolling()
            }
            "call_signals" -> {
                val e = json.decodeFromString(SignalEvent.serializer(), data)
                if (e.action == "create") _rings.tryEmit(e.record)
            }
            // «В сети» собеседника: событие называется как подписка — users/<id>.
            else -> if (type.startsWith("users/")) repo.applyUser(json.decodeFromString(UserEvent.serializer(), data).record)
        }
    }
}
