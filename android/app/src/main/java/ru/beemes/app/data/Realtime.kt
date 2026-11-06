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
class Realtime(private val repo: Repository) {
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

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var source: EventSource? = null
    private var retryJob: Job? = null
    @Volatile private var wanted = false

    private val _rings = MutableSharedFlow<SignalRecord>(extraBufferCapacity = 8)
    /** Звонки, пока приложение открыто: ring — звонят, accept/decline/hangup — звонок закончился. */
    val signals: SharedFlow<SignalRecord> = _rings

    fun start() {
        wanted = true
        if (source == null) connect()
    }

    fun stop() {
        wanted = false
        retryJob?.cancel()
        source?.cancel()
        source = null
    }

    private fun connect() {
        val client = repo.api.client.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()
        val request = Request.Builder().url(repo.api.url("api/realtime")).build()
        source = EventSources.createFactory(client).newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                runCatching { handle(type.orEmpty(), data) }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                source = null
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
                val clientId = json.decodeFromString(Connect.serializer(), data).clientId
                scope.launch {
                    runCatching {
                        repo.api.sendRaw("POST", "api/realtime", buildJsonObject {
                            put("clientId", clientId)
                            put("subscriptions", JsonArray(listOf("messages", "chat_state", "chats", "call_signals").map { JsonPrimitive(it) }))
                        })
                    }
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
            "call_signals" -> {
                val e = json.decodeFromString(SignalEvent.serializer(), data)
                if (e.action == "create") _rings.tryEmit(e.record)
            }
        }
    }
}
