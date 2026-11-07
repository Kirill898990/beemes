package ru.beemes.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import ru.beemes.app.BuildConfig
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Всё, что приложение знает и умеет: вход, профили, чаты, сообщения (шифрует и расшифровывает здесь же),
 * фото, блокировки и звонки. Экраны берут данные отсюда.
 */
class Repository(private val context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val vault = Vault(context)
    /** Учебный профиль «Простой химии» (оценки). */
    val school = School(context, vault)
    @Volatile private var token: String? = prefs.getString("token", null)
    /** Сеанс этого устройства: id и секрет. Секретом приложение само продлевает вход (Настройки → Устройства). */
    @Volatile private var session: SessionSecret? = prefs.getString("device_session", null)?.let { runCatching { kotlinx.serialization.json.Json.decodeFromString(SessionSecret.serializer(), it) }.getOrNull() }
    val api = Api(BuildConfig.SERVER_URL, token = { token }, headers = ::deviceHeaders, renew = ::renewToken)
    private val json get() = api.json

    private var privateKey: ByteArray? = vault.get("private_key")

    private val _me = MutableStateFlow(prefs.getString("me", null)?.let { runCatching { json.decodeFromString(User.serializer(), it) }.getOrNull() })
    val me: StateFlow<User?> = _me.asStateFlow()
    val signedIn: Boolean get() = token != null && privateKey != null && _me.value != null

    private val _users = MutableStateFlow<Map<String, User>>(emptyMap())
    /** Профили людей, которых приложение уже видело. */
    val users: StateFlow<Map<String, User>> = _users.asStateFlow()

    private val _chats = MutableStateFlow<List<ChatItem>>(emptyList())
    val chats: StateFlow<List<ChatItem>> = _chats.asStateFlow()

    private val messageFlows = ConcurrentHashMap<String, MutableStateFlow<List<Msg>>>()
    private val chatCache = ConcurrentHashMap<String, Chat>()
    private val keyCache = ConcurrentHashMap<String, ByteArray>()
    /** Ключи групп: «чат:эпоха» → 32 байта. */
    private val groupRaw = ConcurrentHashMap<String, ByteArray>()
    private val keysTried = ConcurrentHashMap<String, Long>()
    private val myStates = ConcurrentHashMap<String, ChatState>()
    private val peerRead = ConcurrentHashMap<String, Instant>()

    /** Какой чат сейчас открыт (уведомления о нём не нужны, сообщения сразу «прочитаны»). */
    @Volatile var openChatId: String? = null

    val realtime = Realtime(this, context)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // ---------- Вход и регистрация ----------

    suspend fun usernameFree(name: String): UsernameCheck =
        api.get("api/bm/username/${name.trim().lowercase().removePrefix("@")}", UsernameCheck.serializer())

    /** Какие способы входа работают на сервере. */
    suspend fun authOptions(): AuthOptions = runCatching { api.get("api/bm/auth-options", AuthOptions.serializer()) }.getOrDefault(AuthOptions())

    /** Код на почту или телефон для регистрации. */
    suspend fun signupCode(contact: String): CodeSent =
        api.send("POST", "api/bm/signup/code", CodeSent.serializer(), buildJsonObject { put("contact", contact.trim()) })

    /** Вход по почте/телефону: код → [loginVerify] → обычный вход паролем с пропуском. */
    suspend fun loginCode(contact: String): CodeSent =
        api.send("POST", "api/bm/login/code", CodeSent.serializer(), buildJsonObject { put("contact", contact.trim()) })

    suspend fun loginVerify(contact: String, code: String): LoginFound =
        api.send("POST", "api/bm/login/verify", LoginFound.serializer(), buildJsonObject { put("contact", contact.trim()); put("code", code.trim()) })

    suspend fun contact(): ContactInfo = api.get("api/bm/contact", ContactInfo.serializer())

    /** Привязать номер: SMS с кодом → куда отправлено. */
    suspend fun phoneStart(phone: String): String =
        api.send("POST", "api/bm/phone/start", CodeSent.serializer(), buildJsonObject { put("phone", phone.trim()) }).to

    suspend fun phoneConfirm(code: String): String =
        api.send("POST", "api/bm/phone/confirm", ContactInfo.serializer(), buildJsonObject { put("code", code.trim()) }).phone

    suspend fun phoneRemove(password: String) {
        val me = _me.value ?: return
        api.sendRaw("POST", "api/bm/phone/remove", buildJsonObject { put("password", Crypto.authPassword(me.username, password)) })
    }

    /**
     * Регистрация: ключи создаются на телефоне, на сервер уходит только открытый и зашифрованный паролем закрытый.
     * contact и contactCode — необязательная почта или телефон с кодом (по ним потом можно входить).
     */
    suspend fun register(name: String, username: String, password: String, contact: String = "", contactCode: String = "") {
        val login = username.trim().lowercase().removePrefix("@")
        val identity = Crypto.newIdentity()
        val (wrapped, salt) = Crypto.wrapPrivateKey(identity.privateKey, password)
        val auth = Crypto.authPassword(login, password)
        api.sendRaw(
            "POST", "api/collections/users/records",
            buildJsonObject {
                put("name", name.trim())
                put("username", login)
                put("password", auth)
                put("passwordConfirm", auth)
                put("publicKey", Crypto.b64(identity.publicKey))
                put("wrappedKey", wrapped)
                put("wrapSalt", salt)
                if (contact.isNotBlank()) { put("contact", contact.trim()); put("contactCode", contactCode.trim()) }
            },
        )
        login(login, password)
    }

    /**
     * Вход (и на новом телефоне): закрытый ключ скачивается и расшифровывается паролем.
     * Включена 2FA — сервер просит код из письма (ApiException.twoFactor), тогда вход повторяется с code.
     */
    suspend fun login(username: String, password: String, code: String = "", ticket: String = "") {
        val login = username.trim().lowercase().removePrefix("@")
        val auth = api.send(
            "POST", "api/collections/users/auth-with-password", AuthResponse.serializer(),
            buildJsonObject {
                put("identity", login); put("password", Crypto.authPassword(login, password))
                if (code.isNotBlank()) put("code", code.trim())
                // пропуск после кода с почты/телефона — вместо второго кода 2FA
                if (ticket.isNotBlank()) put("ticket", ticket)
            },
        )
        token = auth.token
        val keys = try {
            api.get("api/bm/keys", Keys.serializer())
        } catch (e: Exception) {
            token = null
            throw e
        }
        val priv = try {
            Crypto.unwrapPrivateKey(keys.encKey, keys.keySalt, password)
        } catch (e: Exception) {
            token = null
            throw ApiException("Не получилось расшифровать ключ. Проверьте пароль.")
        }
        check(Crypto.b64(Crypto.publicFromPrivate(priv)) == keys.publicKey) { "Ключи не совпадают" }
        privateKey = priv
        vault.put("private_key", priv)
        keepDeviceSession(auth.meta?.session)
        saveSession(auth.token, auth.record)
    }

    fun logout() {
        // Сразу «не в сети» и закрыть сеанс этого устройства (вход уже забыт — поэтому пропуск передаём явно).
        val t = token
        val s = session
        if (t != null) scope.launch {
            presence(false, withToken = t)
            if (s != null) runCatching { endOwnSession(t, s.id) }
        }
        realtime.stop()
        school.disconnect()
        token = null
        privateKey = null
        vault.clear()
        session = null
        adminCached = null
        prefs.edit().clear().apply()
        _me.value = null
        _chats.value = emptyList()
        messageFlows.clear(); chatCache.clear(); keyCache.clear(); myStates.clear(); peerRead.clear(); groupRaw.clear(); keysTried.clear()
        _users.value = emptyMap()
        _wallpapers.value = emptyMap()
        photoCache.evictAll()
        File(context.cacheDir, "photos").deleteRecursively()
    }

    private fun saveSession(newToken: String, user: User) {
        token = newToken
        prefs.edit().putString("token", newToken).putString("me", json.encodeToString(User.serializer(), user)).apply()
        _me.value = user
        remember(user)
    }

    suspend fun refreshMe() {
        val r = api.send("POST", "api/collections/users/auth-refresh", AuthResponse.serializer())
        saveSession(r.token, r.record)
    }

    // ---------- Сеанс этого устройства ----------

    /** Как называется телефон — его видно в «Устройствах» на других ваших устройствах. */
    val deviceName: String by lazy {
        val maker = android.os.Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val model = android.os.Build.MODEL.orEmpty()
        (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model").trim().ifBlank { "Android" }
    }

    private fun deviceHeaders(): Map<String, String> {
        // В заголовках нельзя кириллицу — название закодировано (сервер раскодирует).
        val name = java.net.URLEncoder.encode(deviceName, "UTF-8").replace("+", "%20")
        val h = mutableMapOf("X-BM-Device" to "android|$name")
        session?.let { h["X-BM-Session"] = it.id }
        return h
    }

    private fun keepDeviceSession(s: SessionSecret?) {
        if (s == null || s.id.isBlank() || s.secret.isBlank()) return
        session = s
        prefs.edit().putString("device_session", json.encodeToString(SessionSecret.serializer(), s)).apply()
    }

    /** Вошли до появления сеансов — заводим сеанс этого телефона (один раз). */
    suspend fun ensureDeviceSession() {
        if (session != null || token == null) return
        runCatching { keepDeviceSession(api.send("POST", "api/bm/session/create", SessionSecret.serializer())) }
    }

    private val renewLock = kotlinx.coroutines.sync.Mutex()

    /**
     * Пропуск перестал действовать (например, на другом устройстве нажали «Завершить другие сеансы»).
     * Продлеваем секретом сеанса. Этот сеанс сами завершили — выходим из аккаунта на этом телефоне.
     */
    private suspend fun renewToken(): Boolean {
        val stale = token
        return renewLock.withLock {
            if (token != stale) return@withLock token != null // пока ждали, вход уже продлили
            val s = session ?: return@withLock false
            try {
                val r = api.send("POST", "api/bm/session/renew", AuthResponse.serializer(), buildJsonObject { put("id", s.id); put("secret", s.secret) })
                if (token == stale && _me.value != null) saveSession(r.token, r.record)
                true
            } catch (e: ApiException) {
                if (e.status == 401 && token == stale) {
                    kotlinx.coroutines.withContext(Dispatchers.Main) { logout() }
                    signedOutRemotely.value = true
                }
                false
            }
        }
    }

    /** Вход на этом телефоне закрыли с другого устройства — экран входа покажет пояснение. */
    val signedOutRemotely = MutableStateFlow(false)

    private suspend fun endOwnSession(t: String, id: String) {
        // X-BM-Session — «это мой сеанс»: сервер закроет только его, не трогая вход на других устройствах
        val request = okhttp3.Request.Builder().url(api.url("api/bm/sessions/$id/end"))
            .post("{}".toRequestBody("application/json".toMediaType()))
            .header("Authorization", t).header("X-BM-Session", id).build()
        kotlinx.coroutines.withContext(Dispatchers.IO) { api.client.newCall(request).execute().close() }
    }

    // ---------- Админ-панель (только у админа: users.admin ставится в панели PocketBase) ----------

    @Volatile private var adminCached: Boolean? = null

    /** Я админ? Спрашиваем сервер один раз (поле скрытое). */
    suspend fun isAdmin(): Boolean = adminCached ?: runCatching { api.get("api/bm/admin/me", AdminMe.serializer()).admin }.getOrDefault(false).also { adminCached = it }

    /** kind: "users" или "chats"; пустой запрос — все с галочкой. */
    suspend fun adminSearch(kind: String, q: String): List<AdminRow> =
        api.get("api/bm/admin/search", AdminList.serializer(), mapOf("kind" to kind, "q" to q.trim())).items

    suspend fun adminBadge(row: AdminRow, badge: Boolean): AdminRow {
        val r = api.send("POST", "api/bm/admin/badge", AdminRow.serializer(), buildJsonObject { put("kind", row.kind); put("id", row.id); put("badge", badge) })
        if (r.kind == "user") _users.value[r.id]?.let { applyUser(it.copy(badge = r.badge)) } else runCatching { refreshChats() }
        return r
    }

    // ---------- Устройства, вход по QR-коду, почта и 2FA ----------

    suspend fun sessions(): List<DeviceSession> = api.get("api/bm/sessions", DeviceList.serializer()).items

    suspend fun endSession(id: String) { api.sendRaw("POST", "api/bm/sessions/$id/end") }

    suspend fun endOtherSessions(): Int = api.send("POST", "api/bm/sessions/end-others", Ended.serializer()).ended

    /** Ссылка из QR-кода нового устройства: …/web/#/qr/<id>/<временный ключ>. */
    fun parseQr(text: String): QrLink? {
        val m = Regex("#/qr/([a-z0-9]{10,40})/([A-Za-z0-9_-]{43})").find(text) ?: return null
        return QrLink(m.groupValues[1], m.groupValues[2])
    }

    suspend fun qrInfo(id: String): QrInfo = api.get("api/bm/qr/$id", QrInfo.serializer())

    /** Подтвердить вход на новом устройстве: ключ переписки уходит зашифрованным для ключа из QR (сервер его не видит). */
    suspend fun qrApprove(link: QrLink) {
        val priv = privateKey ?: throw ApiException("Нужно войти заново")
        val sealed = Crypto.qrSeal(Crypto.unb64url(link.pub), link.id, priv)
        api.sendRaw("POST", "api/bm/qr/${link.id}/approve", buildJsonObject {
            put("e2pub", sealed.e2pub); put("body", sealed.body); put("nonce", sealed.nonce)
        })
    }

    suspend fun qrDecline(id: String) { api.sendRaw("POST", "api/bm/qr/$id/decline") }

    /** Вход на этом телефоне по QR-коду: его сканирует устройство, где вы уже вошли. */
    class QrLogin(val id: String, val link: String, val expiresIn: Int, internal val secret: String, internal val eph: Crypto.Identity)

    suspend fun qrLoginStart(): QrLogin {
        val eph = Crypto.newIdentity()
        val r = api.send("POST", "api/bm/qr/start", QrStart.serializer(), buildJsonObject { put("pub", Crypto.b64(eph.publicKey)) })
        return QrLogin(r.id, "$siteUrl/web/#/qr/${r.id}/${Crypto.b64url(eph.publicKey)}", r.expiresIn, r.secret, eph)
    }

    /** → "pending" (ждём), "declined" (отклонили) или "done" (вошли). */
    suspend fun qrLoginPoll(q: QrLogin): String {
        val r = api.send("POST", "api/bm/qr/${q.id}/poll", QrPoll.serializer(), buildJsonObject { put("secret", q.secret) })
        if (r.token.isBlank()) return r.status.ifBlank { "pending" }
        val p = r.meta?.qr ?: throw ApiException("Ключ не пришёл — попробуйте ещё раз")
        val raw = runCatching { Crypto.qrOpen(q.eph.privateKey, p.e2pub, q.id, p.body, p.nonce) }.getOrNull()
        if (raw == null || Crypto.b64(Crypto.publicFromPrivate(raw)) != r.record.publicKey) throw ApiException("Ключ не подошёл — попробуйте ещё раз")
        privateKey = raw
        vault.put("private_key", raw)
        keepDeviceSession(r.meta.session)
        saveSession(r.token, r.record)
        return "done"
    }

    /** Привязать почту: письмо с кодом → куда отправили (адрес со звёздочками). */
    suspend fun emailStart(email: String): String = api.send("POST", "api/bm/email/start", EmailSent.serializer(), buildJsonObject { put("email", email.trim()) }).to

    suspend fun emailConfirm(code: String) {
        // почта сменилась — сервер обнулил пропуска и сразу выдал новый
        val r = api.send("POST", "api/bm/email/confirm", AuthResponse.serializer(), buildJsonObject { put("code", code.trim()) })
        saveSession(r.token, r.record)
    }

    suspend fun emailRemove(password: String) {
        val me = _me.value ?: return
        val r = api.send("POST", "api/bm/email/remove", AuthResponse.serializer(), buildJsonObject { put("password", Crypto.authPassword(me.username, password)) })
        saveSession(r.token, r.record)
    }

    suspend fun setTwoFactor(enabled: Boolean, password: String) {
        val me = _me.value ?: return
        api.sendRaw("POST", "api/bm/2fa", buildJsonObject { put("enabled", enabled); put("password", Crypto.authPassword(me.username, password)) })
        saveSession(token!!, me.copy(twoFactor = enabled))
    }

    // ---------- Профили ----------

    fun remember(user: User) {
        _users.update { it + (user.id to user) }
    }

    suspend fun user(id: String, fresh: Boolean = false): User {
        if (!fresh) _users.value[id]?.let { return it }
        return api.get("api/collections/users/records/$id", User.serializer()).also { remember(it) }
    }

    /** Поиск по @имени и имени. */
    suspend fun search(query: String): List<User> {
        val q = query.trim().removePrefix("@").replace("'", "").replace("\\", "")
        if (q.length < 2) return emptyList()
        val me = _me.value?.id.orEmpty()
        return api.get(
            "api/collections/users/records", Page.serializer(User.serializer()),
            mapOf("filter" to "(username ~ '$q' || name ~ '$q') && id != '$me'", "perPage" to "30", "sort" to "username"),
        ).items.onEach { remember(it) }
    }

    suspend fun updateProfile(name: String, bio: String, accent: String, statusEmoji: String, hideLastSeen: Boolean, bgEmoji: String = _me.value?.bgEmoji.orEmpty()) {
        val me = _me.value ?: return
        val updated = api.send(
            "PATCH", "api/collections/users/records/${me.id}", User.serializer(),
            buildJsonObject {
                put("name", name.trim()); put("bio", bio.trim()); put("accent", accent)
                put("statusEmoji", statusEmoji); put("hideLastSeen", hideLastSeen); put("bgEmoji", bgEmoji)
            },
        )
        saveSession(token!!, updated)
    }

    /** Новый аватар (jpeg) или null — убрать. */
    suspend fun setAvatar(jpeg: ByteArray?) {
        val me = _me.value ?: return
        val updated = if (jpeg == null) {
            api.send("PATCH", "api/collections/users/records/${me.id}", User.serializer(), buildJsonObject { put("avatar", "") })
        } else {
            api.multipart("PATCH", "api/collections/users/records/${me.id}", User.serializer(), emptyMap(), mapOf("avatar" to Triple("avatar.jpg", "image/jpeg", jpeg)))
        }
        avatarCache.evictAll()
        saveSession(token!!, updated)
    }

    /** Смена пароля: закрытый ключ перешифровывается новым паролем. После смены сервер выдаёт новый вход. */
    suspend fun changePassword(old: String, new: String) {
        val me = _me.value ?: return
        val priv = privateKey ?: throw ApiException("Нужно войти заново")
        val (wrapped, salt) = Crypto.wrapPrivateKey(priv, new)
        val newAuth = Crypto.authPassword(me.username, new)
        api.sendRaw(
            "PATCH", "api/collections/users/records/${me.id}",
            buildJsonObject {
                put("oldPassword", Crypto.authPassword(me.username, old))
                put("password", newAuth); put("passwordConfirm", newAuth)
                put("wrappedKey", wrapped); put("wrapSalt", salt)
            },
        )
        // Смена пароля обнуляет пропуска: этот сеанс продлеваем секретом (без кода из письма), другие сервер закрыл.
        if (session == null || !renewToken()) login(me.username, new)
    }

    suspend fun deleteAccount() {
        val me = _me.value ?: return
        api.sendRaw("DELETE", "api/collections/users/records/${me.id}")
        logout()
    }

    fun avatarUrl(user: User, thumb: String = "160x160"): String? =
        user.avatar.takeIf { it.isNotBlank() }?.let { api.url("api/files/users/${user.id}/$it", mapOf("thumb" to thumb)).toString() }

    // ---------- Чаты ----------

    suspend fun refreshChats() {
        val me = _me.value ?: return
        val list = api.get(
            "api/collections/chats/records", Page.serializer(Chat.serializer()),
            mapOf("expand" to "members,lastMessage", "sort" to "-lastMessageAt,-created", "perPage" to "200"),
        ).items
        val unread = runCatching { api.get("api/bm/unread", UnreadResponse.serializer()).unread }.getOrDefault(emptyMap())
        val states = runCatching {
            api.get("api/collections/chat_state/records", Page.serializer(ChatState.serializer()), mapOf("perPage" to "500")).items
        }.getOrDefault(emptyList())
        states.forEach { s ->
            if (s.user == me.id) rememberState(s)
            else parseTime(s.readAt)?.let { t -> if (peerRead[s.chat]?.isAfter(t) != true) peerRead[s.chat] = t }
        }
        list.forEach { c ->
            chatCache[c.id] = c
            c.expand?.members?.forEach { remember(it) }
            // ключ группы для последнего сообщения
            val last = c.expand?.lastMessage
            if (c.isGroup && !c.isPublic && last != null && groupRaw["${c.id}:${last.epoch}"] == null) runCatching { loadGroupKeys(c.id) }
            if (c.isGroup && last != null && last.sender != me.id) runCatching { user(last.sender) }
        }
        _chats.value = list.mapNotNull { c -> item(c, unread[c.id] ?: 0) }
    }

    private fun item(c: Chat, unread: Int): ChatItem? {
        val me = _me.value ?: return null
        if (c.isGroup) {
            val state = myStates[c.id]
            val last = c.expand?.lastMessage?.let { decrypt(it, c) } ?: messageFlows[c.id]?.value?.lastOrNull()
            // Для групп «собеседник» — сама группа (название вместо имени).
            return ChatItem(c, User(id = c.id, name = c.title), last, unread, state?.muted == true, state?.hidden == true && last == null, peerRead[c.id])
        }
        val peerId = c.members.firstOrNull { it != me.id } ?: return null
        val peer = _users.value[peerId] ?: c.expand?.members?.firstOrNull { it.id == peerId } ?: return null
        val state = myStates[c.id]
        val last = c.expand?.lastMessage?.let { decrypt(it, c, peer) }
            ?: messageFlows[c.id]?.value?.lastOrNull()
        return ChatItem(c, peer, last, unread, state?.muted == true, state?.hidden == true && last == null, peerRead[c.id])
    }

    /** Чат с человеком (если его нет — создаётся). */
    suspend fun chatWith(userId: String): Chat {
        val me = _me.value ?: throw ApiException("Нужно войти")
        val chat = api.send(
            "POST", "api/collections/chats/records", Chat.serializer(),
            buildJsonObject { put("members", kotlinx.serialization.json.JsonArray(listOf(me.id, userId).map { kotlinx.serialization.json.JsonPrimitive(it) })) },
        )
        chatCache[chat.id] = chat
        user(userId)
        if (_chats.value.none { it.chat.id == chat.id }) item(chat, 0)?.let { i -> _chats.update { listOf(i) + it } }
        return chat
    }

    // ---------- Группы и каналы ----------

    @kotlinx.serialization.Serializable private data class Added(val added: List<String> = emptyList(), val epoch: Int = 0)
    @kotlinx.serialization.Serializable private data class Epoch(val epoch: Int = 0)
    @kotlinx.serialization.Serializable private data class Members(val epoch: Int = 0, val members: List<GroupMember> = emptyList())
    @kotlinx.serialization.Serializable private data class Previews(val items: List<GroupPreview> = emptyList())

    /** Создать группу или канал. Ключ создаём здесь и раздаём участникам (сервер его не видит). */
    suspend fun createGroup(type: String, title: String, about: String, members: List<String>, isPublic: Boolean, handle: String): Chat {
        val me = _me.value ?: throw ApiException("Нужно войти")
        val raw = Crypto.newGroupKey()
        val c = api.send("POST", "api/bm/groups", Chat.serializer(), buildJsonObject {
            put("type", type); put("title", title.trim()); put("about", about.trim()); put("isPublic", isPublic); put("handle", handle.trim().removePrefix("@").lowercase())
            put("members", kotlinx.serialization.json.JsonArray(members.map { kotlinx.serialization.json.JsonPrimitive(it) }))
            if (isPublic) put("openKey", Crypto.b64(raw))
        })
        chatCache[c.id] = c
        if (!isPublic) {
            groupRaw["${c.id}:1"] = raw
            shareGroupKey(c.id, 1, raw, listOf(me) + c.members.filter { it != me.id }.mapNotNull { runCatching { user(it) }.getOrNull() })
        }
        refreshChats()
        return c
    }

    /** Свежие данные группы (кто админ, эпоха ключа, вступил ли я). */
    suspend fun reloadChat(id: String): Chat =
        api.get("api/collections/chats/records/$id", Chat.serializer()).also { chatCache[id] = it }

    /** Ссылка-приглашение: код для сервера и ключ после «#» (на сервер не уходит). */
    fun inviteLink(c: Chat): String {
        val base = BuildConfig.SERVER_URL.trimEnd('/')
        if (c.isPublic) return "$base/web/#/c/${c.handle}"
        val raw = groupRaw["${c.id}:${c.keyEpoch}"] ?: return ""
        if (c.inviteCode.isBlank()) return ""
        return "$base/web/#/join/${c.inviteCode}/${c.keyEpoch}.${Crypto.b64url(raw)}"
    }

    suspend fun ensureGroupKey(c: Chat) { if (!c.isPublic && groupKey(c, c.keyEpoch) == null) loadGroupKeys(c.id, force = true) }

    /** Разобрать ссылку beemes: приглашение (код, эпоха, ключ) или публичный канал (@имя). */
    data class Invite(val code: String = "", val epoch: Int = 0, val key: String = "", val handle: String = "")
    fun parseInvite(text: String): Invite? {
        Regex("#/join/([a-z0-9]{8,32})(?:/(\\d+)\\.([A-Za-z0-9_-]{43}))?").find(text)?.let { m ->
            return Invite(code = m.groupValues[1], epoch = m.groupValues[2].toIntOrNull() ?: 0, key = m.groupValues[3])
        }
        Regex("#/c/([a-z0-9_]{4,32})").find(text)?.let { return Invite(handle = it.groupValues[1]) }
        return null
    }

    suspend fun invitePreview(code: String): GroupPreview = api.get("api/bm/invite/$code", GroupPreview.serializer())

    /** Вступить по ссылке: сервер добавляет в участники, ключ из ссылки сохраняем для своих устройств. */
    suspend fun joinByInvite(inv: Invite): Chat {
        val me = _me.value ?: throw ApiException("Нужно войти")
        val c = api.send("POST", "api/bm/join", Chat.serializer(), buildJsonObject { put("code", inv.code) })
        chatCache[c.id] = c
        if (inv.key.isNotBlank() && inv.epoch > 0) {
            val raw = Crypto.unb64url(inv.key)
            if (raw.size == 32) { groupRaw["${c.id}:${inv.epoch}"] = raw; shareGroupKey(c.id, inv.epoch, raw, listOf(me)) }
        }
        refreshChats()
        return c
    }

    suspend fun joinPublic(chatId: String): Chat {
        val c = api.send("POST", "api/bm/join", Chat.serializer(), buildJsonObject { put("chat", chatId) })
        chatCache[c.id] = c
        refreshChats()
        return reloadChat(c.id)
    }

    suspend fun searchChannels(q: String): List<GroupPreview> =
        runCatching { api.get("api/bm/channels", Previews.serializer(), mapOf("q" to q)).items }.getOrDefault(emptyList())

    suspend fun channelByHandle(handle: String): GroupPreview? =
        runCatching { api.get("api/bm/channels", Previews.serializer(), mapOf("handle" to handle)).items.firstOrNull() }.getOrNull()

    suspend fun groupMembers(id: String): List<GroupMember> =
        api.get("api/bm/groups/$id/members", Members.serializer()).members.also { list -> list.forEach { m -> if (_users.value[m.id] == null) remember(m.toUser()) } }

    suspend fun leaveGroup(id: String) {
        api.sendRaw("POST", "api/bm/groups/$id/leave")
        chatCache.remove(id); messageFlows.remove(id)
        _chats.update { l -> l.filterNot { it.chat.id == id } }
    }

    suspend fun deleteGroup(id: String) {
        api.sendRaw("POST", "api/bm/groups/$id/delete")
        chatCache.remove(id); messageFlows.remove(id)
        _chats.update { l -> l.filterNot { it.chat.id == id } }
    }

    suspend fun setAdmin(id: String, userId: String, admin: Boolean) {
        api.sendRaw("POST", "api/bm/groups/$id/admin", buildJsonObject { put("user", userId); put("admin", admin) })
    }

    suspend fun newInvite(id: String): Chat { api.sendRaw("POST", "api/bm/groups/$id/invite"); return reloadChat(id) }

    suspend fun updateGroup(id: String, title: String, about: String): Chat {
        val c = api.send("PATCH", "api/collections/chats/records/$id", Chat.serializer(), buildJsonObject { put("title", title.trim()); put("about", about.trim()) })
        chatCache[id] = c
        refreshChats()
        return c
    }

    /** Добавить людей: сервер записывает их в участники, а ключ им отдаём мы. */
    suspend fun addMembers(id: String, userIds: List<String>) {
        val r = api.send("POST", "api/bm/groups/$id/add", Added.serializer(), buildJsonObject {
            put("users", kotlinx.serialization.json.JsonArray(userIds.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })
        val c = reloadChat(id)
        if (!c.isPublic && r.added.isNotEmpty()) {
            ensureGroupKey(c)
            groupRaw["$id:${c.keyEpoch}"]?.let { raw -> shareGroupKey(id, c.keyEpoch, raw, r.added.mapNotNull { runCatching { user(it) }.getOrNull() }) }
        }
    }

    /** Исключить: сервер меняет эпоху, мы создаём новый ключ и раздаём его оставшимся. */
    suspend fun removeMember(id: String, userId: String) {
        val r = api.send("POST", "api/bm/groups/$id/remove", Epoch.serializer(), buildJsonObject { put("user", userId) })
        val c = reloadChat(id)
        if (!c.isPublic) {
            val raw = Crypto.newGroupKey()
            groupRaw["$id:${r.epoch}"] = raw
            shareGroupKey(id, r.epoch, raw, groupMembers(id).map { it.toUser() })
        }
    }

    /** У кого нет ключа текущей эпохи (вступили, пока нас не было) — отдаём, если он есть у нас. */
    suspend fun healGroupKeys(c: Chat) {
        val me = _me.value ?: return
        if (!c.isGroup || c.isPublic || !c.joined) return
        if (c.isChannel && !c.isAdmin(me.id)) return
        ensureGroupKey(c)
        val raw = groupRaw["${c.id}:${c.keyEpoch}"] ?: return
        val missing = groupMembers(c.id).filter { !it.hasKey }
        if (missing.isNotEmpty()) shareGroupKey(c.id, c.keyEpoch, raw, missing.map { it.toUser() })
    }

    /** Люди, с которыми есть личные чаты, — из них выбираем участников. */
    fun contacts(): List<User> = _chats.value.filter { !it.chat.isGroup }.map { _users.value[it.peer.id] ?: it.peer }

    suspend fun chat(id: String): Chat = chatCache[id] ?: api.get(
        "api/collections/chats/records/$id", Chat.serializer(), mapOf("expand" to "members"),
    ).also { c -> chatCache[id] = c; c.expand?.members?.forEach { remember(it) } }

    fun peerOf(chat: Chat): String = chat.members.firstOrNull { it != _me.value?.id }.orEmpty()

    fun chatItem(chatId: String): ChatItem? = _chats.value.firstOrNull { it.chat.id == chatId }

    fun peerReadAt(chatId: String): Instant? = peerRead[chatId]

    // ---------- Фон чата (личный: собеседник его не видит) ----------

    private val _wallpapers = MutableStateFlow<Map<String, String>>(emptyMap())
    /** Фон каждого чата: "" — соты, "p:<имя>" — готовый, "photo:…" — своё фото. */
    val wallpapers: StateFlow<Map<String, String>> = _wallpapers.asStateFlow()

    private fun rememberState(s: ChatState) {
        myStates[s.chat] = s
        if (_wallpapers.value[s.chat] != s.wallpaper) _wallpapers.update { it + (s.chat to s.wallpaper) }
    }

    /** Ключ для своего фото-фона: свой закрытый ключ + свой открытый (как на сайте). */
    private fun selfKey(chatId: String): ByteArray {
        val me = _me.value ?: throw ApiException("Нужно войти")
        val priv = privateKey ?: throw ApiException("Нужно войти")
        return Crypto.chatKey(priv, Crypto.unb64(me.publicKey), "wallpaper|$chatId")
    }

    /** Готовый фон ("p:<имя>") или обычный (""). */
    suspend fun setWallpaper(chatId: String, value: String) =
        saveState(chatId) { put("wallpaper", value); put("wallpaperFile", kotlinx.serialization.json.JsonNull) }

    /** Своё фото: шифруем, ключ от фото шифруем своим ключом — сервер видит только шифр. */
    suspend fun setWallpaperPhoto(chatId: String, uri: Uri) {
        val me = _me.value ?: return
        val photo = Photos.prepare(context, uri)
        val (blob, key) = Crypto.encryptFile(photo.jpeg)
        val content = buildJsonObject { put("k", Crypto.b64(key)) }.toString().toByteArray()
        val sealed = Crypto.seal(selfKey(chatId), content, "wallpaper|$chatId|${me.id}")
        if (myStates[chatId] == null) saveState(chatId) {}
        val id = myStates[chatId]?.id ?: return
        val value = "photo:${sealed.nonce}.${sealed.body}"
        BitmapFactory.decodeByteArray(photo.jpeg, 0, photo.jpeg.size)?.let { photoCache.put("wp:$value", it) }
        val saved = api.multipart(
            "PATCH", "api/collections/chat_state/records/$id", ChatState.serializer(),
            mapOf("wallpaper" to value), mapOf("wallpaperFile" to Triple("wallpaper.bin", "application/octet-stream", blob)),
        )
        rememberState(saved)
    }

    /** Своё фото-фон этого чата (расшифрованное) или null. */
    suspend fun wallpaperPhoto(chatId: String): Bitmap? {
        val st = myStates[chatId] ?: return null
        if (!st.wallpaper.startsWith("photo:") || st.wallpaperFile.isBlank()) return null
        photoCache.get("wp:${st.wallpaper}")?.let { return it }
        val me = _me.value ?: return null
        val parts = st.wallpaper.removePrefix("photo:").split(".", limit = 2)
        if (parts.size != 2) return null
        val opened = String(Crypto.open(selfKey(chatId), parts[1], parts[0], "wallpaper|$chatId|${me.id}"))
        val k = (json.parseToJsonElement(opened) as kotlinx.serialization.json.JsonObject)["k"]
            ?.let { (it as kotlinx.serialization.json.JsonPrimitive).content } ?: return null
        val blob = api.download(api.url("api/files/chat_state/${st.id}/${st.wallpaperFile}", mapOf("token" to fileToken())))
        val bytes = Crypto.decryptFile(blob, Crypto.unb64(k))
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { photoCache.put("wp:${st.wallpaper}", it) }
    }

    suspend fun setMuted(chatId: String, muted: Boolean) {
        saveState(chatId) { put("muted", muted) }
        _chats.update { l -> l.map { if (it.chat.id == chatId) it.copy(muted = muted) else it } }
    }

    /** Убрать чат из списка (вернётся с новым сообщением). */
    suspend fun hideChat(chatId: String) {
        saveState(chatId) { put("hidden", true) }
        _chats.update { l -> l.filterNot { it.chat.id == chatId } }
    }

    /** Отметить чат прочитанным до последнего сообщения. */
    suspend fun markRead(chatId: String) {
        val last = messageFlows[chatId]?.value?.lastOrNull { it.status != SendStatus.SENDING } ?: return
        val current = parseTime(myStates[chatId]?.readAt.orEmpty())
        if (current != null && !last.created.isAfter(current)) return
        saveState(chatId) { put("readAt", serverTime(last.created)) }
        _chats.update { l -> l.map { if (it.chat.id == chatId) it.copy(unread = 0) else it } }
    }

    private suspend fun saveState(chatId: String, body: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) {
        val me = _me.value ?: return
        val existing = myStates[chatId]
        val saved = if (existing != null) {
            api.send("PATCH", "api/collections/chat_state/records/${existing.id}", ChatState.serializer(), buildJsonObject(body))
        } else {
            api.send("POST", "api/collections/chat_state/records", ChatState.serializer(), buildJsonObject {
                put("chat", chatId); put("user", me.id); body()
            })
        }
        rememberState(saved)
    }

    // ---------- Сообщения ----------

    fun messages(chatId: String): StateFlow<List<Msg>> = messageFlows.getOrPut(chatId) { MutableStateFlow(emptyList()) }

    private fun keyFor(chat: Chat, peer: User?): ByteArray? {
        keyCache[chat.id]?.let { return it }
        val priv = privateKey ?: return null
        val pub = peer?.publicKey?.takeIf { it.isNotBlank() } ?: return null
        return Crypto.chatKey(priv, Crypto.unb64(pub), chat.id).also { keyCache[chat.id] = it }
    }

    // ---------- Ключи групп и каналов ----------

    /** Загрузить свои экземпляры ключей группы и расшифровать (не чаще раза в 10 секунд). */
    suspend fun loadGroupKeys(chatId: String, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - (keysTried[chatId] ?: 0L) < 10_000) return
        keysTried[chatId] = now
        val me = _me.value ?: return
        val priv = privateKey ?: return
        val rows = api.get("api/collections/chat_keys/records", Page.serializer(ChatKey.serializer()), mapOf("filter" to "chat = '$chatId'", "perPage" to "200")).items
        rows.forEach { r ->
            val id = "$chatId:${r.epoch}"
            if (groupRaw[id] != null) return@forEach
            runCatching {
                val from = if (r.from == me.id) me else user(r.from)
                groupRaw[id] = Crypto.unwrapGroupKey(priv, Crypto.unb64(from.publicKey), chatId, r.epoch, me.id, r.body, r.nonce)
            }
        }
    }

    private fun groupKey(chat: Chat, epoch: Int): ByteArray? =
        if (chat.isPublic) chat.openKey.takeIf { it.isNotBlank() }?.let { Crypto.unb64(it) } else groupRaw["${chat.id}:$epoch"]

    /** Отдать ключ эпохи участникам. */
    private suspend fun shareGroupKey(chatId: String, epoch: Int, raw: ByteArray, users: List<User>) {
        val me = _me.value ?: return
        val priv = privateKey ?: return
        users.forEach { u ->
            if (u.publicKey.isBlank()) return@forEach
            val w = Crypto.wrapGroupKey(priv, Crypto.unb64(u.publicKey), chatId, epoch, u.id, raw)
            runCatching {
                api.sendRaw("POST", "api/collections/chat_keys/records", buildJsonObject {
                    put("chat", chatId); put("user", u.id); put("epoch", epoch); put("from", me.id); put("body", w.body); put("nonce", w.nonce)
                })
            }
        }
    }

    fun decrypt(r: MessageRecord, chat: Chat? = chatCache[r.chat], peer: User? = chat?.let { _users.value[peerOf(it)] }): Msg {
        val content = runCatching {
            val key = if (chat!!.isGroup) groupKey(chat, r.epoch)!! else keyFor(chat, peer)!!
            json.decodeFromString(Content.serializer(), String(Crypto.open(key, r.body, r.nonce, Crypto.messageAad(r.chat, r.sender))))
        }.getOrNull()
        return Msg(
            id = r.id, chatId = r.chat, senderId = r.sender, kind = r.kind, content = content,
            created = parseTime(r.created) ?: Instant.now(), edited = r.editedAt.isNotBlank(), file = r.file, replyTo = r.replyTo,
            epoch = r.epoch, status = statusFor(r.chat, r.sender, parseTime(r.created)),
        )
    }

    /** Расшифровать сообщение группы из push: в уведомлении — мой экземпляр ключа (или открытый ключ канала). */
    fun decryptGroupPush(d: Map<String, String>): Content? = runCatching {
        val me = _me.value ?: return null
        val priv = privateKey ?: return null
        val chatId = d["chat"].orEmpty()
        val epoch = d["epoch"]?.toIntOrNull() ?: 0
        val key = d["openKey"]?.takeIf { it.isNotBlank() }?.let { Crypto.unb64(it) }
            ?: groupRaw["$chatId:$epoch"]
            ?: Crypto.unwrapGroupKey(priv, Crypto.unb64(d["keyFromPub"]!!), chatId, epoch, me.id, d["keyBody"]!!, d["keyNonce"]!!)
                .also { if (epoch > 0) groupRaw["$chatId:$epoch"] = it }
        json.decodeFromString(Content.serializer(), String(Crypto.open(key, d["body"]!!, d["nonce"]!!, Crypto.messageAad(chatId, d["sender"].orEmpty()))))
    }.getOrNull()

    /** Расшифровать сообщение из push-уведомления (без запроса к серверу). */
    fun decryptPush(chatId: String, senderId: String, senderKey: String, body: String, nonce: String): Content? = runCatching {
        val priv = privateKey ?: return null
        val key = keyCache[chatId] ?: Crypto.chatKey(priv, Crypto.unb64(senderKey), chatId)
        json.decodeFromString(Content.serializer(), String(Crypto.open(key, body, nonce, Crypto.messageAad(chatId, senderId))))
    }.getOrNull()

    private fun statusFor(chatId: String, sender: String, created: Instant?): SendStatus {
        if (sender != _me.value?.id) return SendStatus.SENT
        val read = peerRead[chatId]
        return if (read != null && created != null && !created.isAfter(read)) SendStatus.READ else SendStatus.SENT
    }

    /** Загрузить сообщения (новые) или более ранние (before). → есть ли ещё более ранние. */
    suspend fun loadMessages(chatId: String, before: Instant? = null): Boolean {
        val chat = chat(chatId)
        val page = if (chat.isPublic && !chat.joined) {
            // Публичный канал до подписки: посты отдаёт отдельный запрос.
            val r = api.get("api/bm/channels/$chatId/posts", PostsResponse.serializer(), before?.let { mapOf("before" to serverTime(it)) } ?: emptyMap())
            Page(items = r.items, totalPages = if (r.more) 2 else 1)
        } else {
            if (!chat.isGroup) user(peerOf(chat))
            val filter = "chat = '$chatId'" + (before?.let { " && created < '${serverTime(it)}'" } ?: "")
            api.get(
                "api/collections/messages/records", Page.serializer(MessageRecord.serializer()),
                mapOf("filter" to filter, "sort" to "-created", "perPage" to "60"),
            )
        }
        if (chat.isGroup && !chat.isPublic && page.items.any { groupRaw["$chatId:${it.epoch}"] == null }) runCatching { loadGroupKeys(chatId, force = true) }
        if (chat.isGroup) page.items.map { it.sender }.distinct().filter { _users.value[it] == null }.forEach { runCatching { user(it) } }
        val loaded = page.items.map { decrypt(it, chat) }
        val flow = messageFlows.getOrPut(chatId) { MutableStateFlow(emptyList()) }
        flow.update { current ->
            val pending = current.filter { it.status == SendStatus.SENDING || it.status == SendStatus.FAILED }
            val byId = (if (before == null) emptyMap() else current.filter { it.status != SendStatus.SENDING && it.status != SendStatus.FAILED }.associateBy { it.id }) +
                loaded.associateBy { it.id }
            (byId.values.sortedBy { it.created } + pending)
        }
        return page.totalPages > 1
    }

    /** Зашифровать содержимое. → шифр и эпоха (для групп; у личного чата null). */
    private suspend fun seal(chatId: String, content: Content): Pair<Crypto.Sealed, Int?> {
        val me = _me.value ?: throw ApiException("Нужно войти")
        var chat = chat(chatId)
        if (chat.isGroup) {
            // эпоха могла смениться (кого-то исключили) — берём свежую
            if (!chat.isPublic) runCatching { api.get("api/collections/chats/records/$chatId", Chat.serializer()) }.getOrNull()?.let { chat = it; chatCache[chatId] = it }
            val epoch = chat.sendEpoch
            if (groupKey(chat, epoch) == null) runCatching { loadGroupKeys(chatId, force = true) }
            val key = groupKey(chat, epoch) ?: throw ApiException("Ключ шифрования группы ещё не пришёл. Попросите админа открыть группу.")
            return Crypto.seal(key, json.encodeToString(Content.serializer(), content).toByteArray(), Crypto.messageAad(chatId, me.id)) to epoch
        }
        val peer = user(peerOf(chat))
        val key = keyFor(chat, peer) ?: throw ApiException("Нет ключа шифрования собеседника")
        return Crypto.seal(key, json.encodeToString(Content.serializer(), content).toByteArray(), Crypto.messageAad(chatId, me.id)) to null
    }


    suspend fun sendText(chatId: String, text: String, replyTo: String = "") =
        send(chatId, "text", Content(t = text.trim()), replyTo, null)

    suspend fun sendPhoto(chatId: String, photo: Photos.Prepared, caption: String) {
        val (blob, key) = Crypto.encryptFile(photo.jpeg)
        val content = Content(k = Crypto.b64(key), w = photo.width, h = photo.height, p = photo.preview, c = caption.trim().ifBlank { null })
        photoCache.put("local:" + content.k, BitmapFactory.decodeByteArray(photo.jpeg, 0, photo.jpeg.size))
        send(chatId, "photo", content, "", blob)
    }

    /** Стикер из набора: st = «набор/имя», e — его эмодзи (его же видят старые версии приложения). */
    suspend fun sendSticker(chatId: String, st: String, e: String) =
        send(chatId, "sticker", Content(t = e, st = st, e = e), "", null)

    suspend fun sendCallLog(chatId: String, video: Boolean, seconds: Int, status: String) =
        runCatching { send(chatId, "call", Content(v = video, d = seconds, s = status), "", null) }

    private suspend fun send(chatId: String, kind: String, content: Content, replyTo: String, file: ByteArray?) {
        val me = _me.value ?: return
        val localId = "local-" + UUID.randomUUID()
        val pending = Msg(localId, chatId, me.id, kind, content, Instant.now(), replyTo = replyTo, status = SendStatus.SENDING, localId = localId)
        val flow = messageFlows.getOrPut(chatId) { MutableStateFlow(emptyList()) }
        flow.update { it + pending }
        try {
            val (sealed, epoch) = seal(chatId, content)
            // Свой id сообщения: если связь оборвалась, повтор с тем же id не создаст дубль.
            val recordId = newRecordId()
            // pushLater — уведомления попросим отдельно (ниже), чтобы отправка не ждала Firebase.
            val fields = mapOf("id" to recordId, "chat" to chatId, "sender" to me.id, "kind" to kind, "body" to sealed.body, "nonce" to sealed.nonce, "pushLater" to "1") +
                (if (replyTo.isNotBlank()) mapOf("replyTo" to replyTo) else emptyMap()) +
                (if (epoch != null) mapOf("epoch" to epoch.toString()) else emptyMap())
            var result: MessageRecord? = null
            var attempt = 0
            while (result == null) {
                try {
                    result = if (file != null) {
                        api.multipart("POST", "api/collections/messages/records", MessageRecord.serializer(), fields, mapOf("file" to Triple("photo.bin", "application/octet-stream", file)))
                    } else {
                        api.send("POST", "api/collections/messages/records", MessageRecord.serializer(), buildJsonObject {
                            fields.forEach { (k, v) -> if (k == "epoch") put(k, v.toInt()) else put(k, v) }
                        })
                    }
                } catch (e: ApiException) {
                    when {
                        // прошлая попытка всё-таки дошла (ответ потерялся) — сообщение уже на сервере
                        e.status == 400 && "id" in e.fields -> result = api.get("api/collections/messages/records/$recordId", MessageRecord.serializer())
                        // нет связи или сервер занят — пробуем ещё (тем же id)
                        (e.status == 0 || e.status == 429 || e.status >= 500) && attempt < 4 -> kotlinx.coroutines.delay(longArrayOf(1500, 3000, 6000, 10000)[attempt++])
                        else -> throw e
                    }
                }
            }
            val saved = result!!
            scope.launch { runCatching { api.sendRaw("POST", "api/bm/messages/$recordId/notify") } }
            val msg = pending.copy(id = saved.id, created = parseTime(saved.created) ?: pending.created, file = saved.file, status = SendStatus.SENT)
            flow.update { list -> (list.filterNot { it.id == localId || it.id == saved.id } + msg).sortedWith(compareBy({ it.status == SendStatus.SENDING || it.status == SendStatus.FAILED }, { it.created })) }
            onNewMessage(msg)
        } catch (e: Exception) {
            flow.update { list -> list.map { if (it.id == localId) it.copy(status = SendStatus.FAILED, error = e.message) else it } }
        }
    }

    private val idRandom = java.security.SecureRandom()

    /** id записи PocketBase: 15 символов a-z0-9. */
    private fun newRecordId(): String = buildString { repeat(15) { append("abcdefghijklmnopqrstuvwxyz0123456789"[idRandom.nextInt(36)]) } }

    /** Повторить неотправленное. */
    suspend fun retry(msg: Msg) {
        messageFlows[msg.chatId]?.update { l -> l.filterNot { it.id == msg.id } }
        if (msg.kind == "text") sendText(msg.chatId, msg.text, msg.replyTo)
    }

    fun discard(msg: Msg) {
        messageFlows[msg.chatId]?.update { l -> l.filterNot { it.id == msg.id } }
    }

    suspend fun edit(msg: Msg, text: String) {
        val (sealed, epoch) = seal(msg.chatId, (msg.content ?: Content()).copy(t = text.trim()))
        if (epoch != null && epoch != msg.epoch) throw ApiException("Это сообщение уже не изменить: ключ группы сменился")
        val saved = api.send("PATCH", "api/collections/messages/records/${msg.id}", MessageRecord.serializer(), buildJsonObject {
            put("body", sealed.body); put("nonce", sealed.nonce)
        })
        applyRecord(saved)
    }

    suspend fun delete(msg: Msg) {
        api.sendRaw("DELETE", "api/collections/messages/records/${msg.id}")
        removeMessage(msg.chatId, msg.id)
    }

    private fun onNewMessage(msg: Msg) {
        val chatId = msg.chatId
        val existing = _chats.value.firstOrNull { it.chat.id == chatId }
        if (existing != null) {
            val unread = if (msg.senderId != _me.value?.id && openChatId != chatId) existing.unread + 1 else existing.unread
            val updated = existing.copy(last = msg, unread = unread, hidden = false, chat = existing.chat.copy(lastMessageAt = serverTime(msg.created)))
            _chats.update { l -> listOf(updated) + l.filterNot { it.chat.id == chatId } }
        }
    }

    // ---------- Сообщения в реальном времени ----------

    private val presenceAsked = ConcurrentHashMap<String, Long>()

    /**
     * Свежий «в сети» человека с сервера. Сервер сообщает о смене статуса только в момент входа и выхода —
     * если это случилось, пока мы за человеком ещё не следили (новый собеседник, поток событий придержали),
     * статус устарел. Спрашиваем, когда от него пришло сообщение или он появился в списке (раз в 15 с).
     */
    fun refreshPresence(id: String) {
        val me = _me.value?.id ?: return
        if (id.isBlank() || id == me) return
        val now = System.currentTimeMillis()
        if (now - (presenceAsked[id] ?: 0L) < 15_000) return
        presenceAsked[id] = now
        scope.launch { runCatching { applyUser(user(id, fresh = true)) } }
    }

    internal fun applyRecord(r: MessageRecord) {
        // написал — значит, сейчас в сети: берём его свежий статус
        if (r.sender != _me.value?.id) refreshPresence(r.sender)
        val chat = chatCache[r.chat]
        if (chat != null && chat.isGroup && groupKey(chat, r.epoch) == null) {
            // ключа этой эпохи ещё нет — подгружаем и показываем сообщение уже расшифрованным
            scope.launch { runCatching { loadGroupKeys(r.chat, force = true); if (r.sender != _me.value?.id) user(r.sender); applyRecordNow(r) } }
            return
        }
        applyRecordNow(r)
    }

    private fun applyRecordNow(r: MessageRecord) {
        val chat = chatCache[r.chat]
        val msg = decrypt(r, chat)
        val flow = messageFlows.getOrPut(r.chat) { MutableStateFlow(emptyList()) }
        var isNew = false
        flow.update { list ->
            if (list.any { it.id == r.id }) list.map { if (it.id == r.id) msg.copy(status = it.status.takeIf { s -> s == SendStatus.READ } ?: msg.status) else it }
            else { isNew = true; (list + msg).sortedWith(compareBy({ it.status == SendStatus.SENDING || it.status == SendStatus.FAILED }, { it.created })) }
        }
        if (isNew) {
            if (chat == null || _chats.value.none { it.chat.id == r.chat }) {
                // Новый чат — обновляем весь список.
                scope.launch { runCatching { refreshChats() } }
            } else onNewMessage(msg)
        }
    }

    internal fun removeMessage(chatId: String, id: String) {
        messageFlows[chatId]?.update { l -> l.filterNot { it.id == id } }
        val item = _chats.value.firstOrNull { it.chat.id == chatId }
        if (item?.last?.id == id) {
            val prev = messageFlows[chatId]?.value?.lastOrNull()
            _chats.update { l -> l.map { if (it.chat.id == chatId) it.copy(last = prev) else it } }
        }
    }

    internal fun applyState(s: ChatState) {
        if (s.user == _me.value?.id) { rememberState(s); return }
        var read = parseTime(s.readAt) ?: return
        // в группе «прочитано», когда прочитал хоть кто-то
        peerRead[s.chat]?.let { if (it.isAfter(read)) read = it }
        peerRead[s.chat] = read
        messageFlows[s.chat]?.update { l ->
            l.map { if (it.senderId == _me.value?.id && it.status == SendStatus.SENT && !it.created.isAfter(read)) it.copy(status = SendStatus.READ) else it }
        }
        _chats.update { l -> l.map { if (it.chat.id == s.chat) it.copy(peerReadAt = read) else it } }
    }

    // ---------- Фото ----------

    private val photoCache = object : LruCache<String, Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val avatarCache = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private var fileToken: Pair<String, Long>? = null

    private suspend fun fileToken(): String {
        fileToken?.let { (t, until) -> if (System.currentTimeMillis() < until) return t }
        val t = api.send("POST", "api/files/token", FileToken.serializer()).token
        fileToken = t to System.currentTimeMillis() + 90_000
        return t
    }

    fun cachedPhoto(msg: Msg): Bitmap? = msg.content?.k?.let { photoCache.get("local:$it") } ?: photoCache.get(msg.id)

    /** Скачать и расшифровать фото (с кэшем в памяти и в папке приложения). */
    suspend fun photo(msg: Msg): Bitmap? {
        cachedPhoto(msg)?.let { return it }
        val key = msg.content?.k ?: return null
        if (msg.file.isBlank()) return null
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val cached = File(dir, msg.id + ".jpg")
        val bytes = if (cached.exists()) cached.readBytes() else {
            val blob = api.download(api.url("api/files/messages/${msg.id}/${msg.file}", mapOf("token" to fileToken())))
            Crypto.decryptFile(blob, Crypto.unb64(key)).also { runCatching { cached.writeBytes(it) } }
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { photoCache.put(msg.id, it) }
    }

    suspend fun avatar(user: User, thumb: String = "160x160"): Bitmap? {
        val url = avatarUrl(user, thumb) ?: return null
        avatarCache.get(url)?.let { return it }
        return runCatching {
            val bytes = api.download(api.url("api/files/users/${user.id}/${user.avatar}", mapOf("thumb" to thumb)))
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()?.also { avatarCache.put(url, it) }
    }

    fun cachedAvatar(user: User, thumb: String = "160x160"): Bitmap? = avatarUrl(user, thumb)?.let { avatarCache.get(it) }

    /** Фото группы или канала. */
    private fun groupPhotoUrl(chatId: String, photo: String, thumb: String) = api.url("api/files/chats/$chatId/$photo", mapOf("thumb" to thumb)).toString()

    fun cachedGroupPhoto(chatId: String, photo: String, thumb: String = "160x160"): Bitmap? =
        photo.takeIf { it.isNotBlank() }?.let { avatarCache.get(groupPhotoUrl(chatId, it, thumb)) }

    suspend fun groupPhoto(chatId: String, photo: String, thumb: String = "160x160"): Bitmap? {
        if (photo.isBlank()) return null
        val url = groupPhotoUrl(chatId, photo, thumb)
        avatarCache.get(url)?.let { return it }
        return runCatching {
            val bytes = api.download(url.toHttpUrl())
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()?.also { avatarCache.put(url, it) }
    }

    /** Поставить (jpeg) или убрать (null) фото группы/канала — могут админы. */
    suspend fun setGroupPhoto(chatId: String, jpeg: ByteArray?): Chat {
        if (jpeg == null) api.sendRaw("PATCH", "api/collections/chats/records/$chatId", buildJsonObject { put("photo", "") })
        else api.multipart("PATCH", "api/collections/chats/records/$chatId", Chat.serializer(), emptyMap(), mapOf("photo" to Triple("photo.jpg", "image/jpeg", jpeg)))
        runCatching { refreshChats() }
        return reloadChat(chatId)
    }

    fun preparePhoto(uri: Uri): Photos.Prepared = Photos.prepare(context, uri)

    // ---------- Блокировки ----------

    suspend fun blocked(): List<Block> =
        api.get("api/collections/blocks/records", Page.serializer(Block.serializer()), mapOf("perPage" to "200")).items

    suspend fun block(userId: String) {
        val me = _me.value ?: return
        api.sendRaw("POST", "api/collections/blocks/records", buildJsonObject { put("user", me.id); put("blocked", userId) })
    }

    suspend fun unblock(userId: String) {
        blocked().filter { it.blocked == userId }.forEach { api.sendRaw("DELETE", "api/collections/blocks/records/${it.id}") }
    }

    // ---------- Телефон, «в сети», уведомления ----------

    suspend fun registerPush(fcmToken: String) {
        val me = _me.value ?: return
        if (prefs.getString("push_token", null) == fcmToken + "|" + me.id) return
        api.sendRaw("POST", "api/collections/devices/records", buildJsonObject {
            put("user", me.id); put("token", fcmToken); put("platform", "android"); put("appVersion", BuildConfig.VERSION_NAME)
        })
        prefs.edit().putString("push_token", fcmToken + "|" + me.id).apply()
    }

    private val deviceId: String by lazy {
        prefs.getString("device_id", null) ?: ("a" + UUID.randomUUID().toString().replace("-", "").take(16)).also {
            prefs.edit().putString("device_id", it).apply()
        }
    }
    private var presenceSeq = 0L

    /**
     * Сообщить серверу: приложение на экране (online, каждые 20 секунд) или свёрнуто/закрыто (offline).
     * Собеседники видят «в сети» и его пропажу сразу. seq — номер сигнала: запоздавший старый не перебьёт новый.
     */
    suspend fun presence(online: Boolean, withToken: String? = null) {
        val t = withToken ?: token ?: return
        val seq = synchronized(this) { presenceSeq = maxOf(presenceSeq + 1, System.currentTimeMillis()); presenceSeq }
        runCatching {
            api.sendRaw("POST", "api/bm/presence", buildJsonObject {
                put("state", if (online) "online" else "offline"); put("device", deviceId); put("seq", seq)
                session?.let { put("session", it.id) }
                if (withToken != null) put("token", t)
            })
        }
    }

    /** Обновление записи человека пришло в реальном времени (вошёл или вышел из сети). */
    fun applyUser(user: User) {
        if (user.id.isBlank()) return
        remember(user)
        _chats.update { l -> l.map { if (it.peer.id == user.id) it.copy(peer = user) else it } }
    }

    /** id собеседников — за их «в сети» следим в реальном времени. */
    fun peerIds(): List<String> = _chats.value.map { it.peer.id }.distinct().take(300)

    private var clockJob: kotlinx.coroutines.Job? = null

    /** Пока приложение на экране — часы «в сети» тикают ровно тогда, когда у кого-то истекает «в сети». */
    fun startPresenceClock() {
        clockJob?.cancel()
        clockJob = scope.launch {
            kotlinx.coroutines.flow.combine(users, chats) { u, c -> u.values.map { it.onlineUntilMillis } + c.map { it.peer.onlineUntilMillis } }
                .collectLatest { untils ->
                    while (true) {
                        val now = System.currentTimeMillis()
                        val next = untils.filter { it > now }.minOrNull()
                        kotlinx.coroutines.delay(if (next == null) 30_000 else (next - now + 300).coerceAtMost(30_000))
                        PresenceClock.now.value = System.currentTimeMillis()
                    }
                }
        }
    }

    fun stopPresenceClock() { clockJob?.cancel() }

    var notificationsEnabled: Boolean
        get() = prefs.getBoolean("notifications", true)
        set(v) = prefs.edit().putBoolean("notifications", v).apply()

    var theme: String
        get() = prefs.getString("theme", "system") ?: "system"
        set(v) = prefs.edit().putString("theme", v).apply()

    // ---------- Звонки ----------

    suspend fun incoming(): Incoming? = runCatching { api.get("api/bm/incoming", IncomingResponse.serializer()).call }.getOrNull()

    suspend fun declineCall(chatId: String, callId: String, from: String) {
        val me = _me.value ?: return
        runCatching {
            api.sendRaw("POST", "api/collections/call_signals/records", buildJsonObject {
                put("call", callId); put("from", me.id); put("to", from); put("chat", chatId); put("type", "decline")
            })
        }
    }

    /** Страница звонка на сервере (её показывает CallActivity). Вход передаётся после «#» и не уходит на сервер. */
    fun callUrl(chatId: String, video: Boolean, answerCall: String? = null): String {
        val params = buildList {
            add("chat=$chatId")
            if (video) add("video=1")
            if (answerCall != null) { add("call=$answerCall"); add("answer=1") }
            add("app=1")
            add("token=" + Uri.encode(token.orEmpty()))
        }
        return BuildConfig.SERVER_URL.trimEnd('/') + "/call.html#" + params.joinToString("&")
    }

    // ---------- Новая версия ----------

    suspend fun latestRelease(): AppRelease? = runCatching {
        api.get("api/collections/app_releases/records", Page.serializer(AppRelease.serializer()), mapOf("sort" to "-versionCode", "perPage" to "1")).items.firstOrNull()
    }.getOrNull()

    val siteUrl: String get() = BuildConfig.SERVER_URL.trimEnd('/')
}
