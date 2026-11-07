package ru.beemes.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Ошибка сервера с понятным текстом. fields — ошибки отдельных полей (например, «username»). */
class ApiException(message: String, val status: Int = 0, val fields: Map<String, String> = emptyMap(), val twoFactor: String? = null) : Exception(message)

/**
 * Связь с сервером beemes (PocketBase).
 * headers — устройство и сеанс (X-BM-Device, X-BM-Session); renew — продлить вход секретом сеанса, если пропуск устарел.
 */
class Api(
    baseUrl: String,
    private val token: () -> String?,
    private val headers: () -> Map<String, String> = { emptyMap() },
    private val renew: suspend () -> Boolean = { false },
) {
    val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    fun url(path: String, query: Map<String, String> = emptyMap()): HttpUrl =
        base.newBuilder().addPathSegments(path.trimStart('/')).apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    suspend fun <T> get(path: String, serializer: KSerializer<T>, query: Map<String, String> = emptyMap()): T =
        json.decodeFromString(serializer, raw("GET", url(path, query), null))

    suspend fun <T> send(method: String, path: String, serializer: KSerializer<T>, body: JsonObject? = null): T =
        json.decodeFromString(serializer, raw(method, url(path), body?.toString()?.toRequestBody(JSON)))

    suspend fun sendRaw(method: String, path: String, body: JsonObject? = null): String =
        raw(method, url(path), body?.toString()?.toRequestBody(JSON) ?: if (method == "GET" || method == "DELETE") null else "{}".toRequestBody(JSON))

    /** Запрос с файлом (фото, аватар). files: имя поля → (имя файла, тип, байты). */
    suspend fun <T> multipart(
        method: String,
        path: String,
        serializer: KSerializer<T>,
        fields: Map<String, String>,
        files: Map<String, Triple<String, String, ByteArray>>,
    ): T {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            files.forEach { (k, f) -> addFormDataPart(k, f.first, f.third.toRequestBody(f.second.toMediaType())) }
        }.build()
        return json.decodeFromString(serializer, raw(method, url(path), body))
    }

    /** Скачать файл (байты). */
    suspend fun download(url: HttpUrl): ByteArray = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).apply { token()?.let { header("Authorization", it) }; headers().forEach { (k, v) -> header(k, v) } }.build()
        try {
            client.newCall(request).execute().use { r ->
                if (!r.isSuccessful) throw ApiException("Не получилось загрузить файл", r.code)
                r.body.bytes()
            }
        } catch (e: IOException) {
            throw ApiException("Нет связи с сервером. Проверьте интернет.")
        }
    }

    private suspend fun raw(method: String, url: HttpUrl, body: RequestBody?, retried: Boolean = false): String {
        val (code, text) = withContext(Dispatchers.IO) {
            val request = Request.Builder().url(url)
                .method(method, body ?: if (method == "POST" || method == "PATCH") "{}".toRequestBody(JSON) else null)
                .apply { token()?.let { header("Authorization", it) }; headers().forEach { (k, v) -> header(k, v) } }
                .build()
            val response = try {
                client.newCall(request).execute()
            } catch (e: IOException) {
                throw ApiException("Нет связи с сервером. Проверьте интернет.")
            }
            response.use { r -> r.code to r.body.string() }
        }
        // Пропуск больше не действует (истёк или сеансы перезапустили) — продлеваем секретом сеанса и повторяем.
        val path = url.encodedPath
        if (code == 401 && !retried && token() != null && "auth-with-password" !in path && "session/renew" !in path && renew()) {
            return raw(method, url, body, retried = true)
        }
        if (code !in 200..299) throw parseError(code, text)
        return text
    }

    private fun parseError(status: Int, text: String): ApiException {
        var message = ""
        val fields = mutableMapOf<String, String>()
        var twoFactor: String? = null
        runCatching {
            val obj = json.parseToJsonElement(text).jsonObject
            message = obj["message"]?.jsonPrimitive?.contentOrNull.orEmpty()
            obj["data"]?.jsonObject?.forEach { (field, value) ->
                val code = runCatching { value.jsonObject["code"]?.jsonPrimitive?.contentOrNull }.getOrNull().orEmpty()
                // 2FA: пароль верный, нужен код из письма (в сообщении — куда отправлен)
                if (field == "twoFactor") twoFactor = runCatching { value.jsonObject["message"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                    ?.trimEnd('.')?.lowercase() ?: "вашу почту"
                else fields[field] = fieldMessage(field, code)
            }
        }
        if (twoFactor != null) return ApiException("Введите код из письма", status, fields, twoFactor)
        val russian = message.trimEnd('.').takeIf { Regex("[а-яё]", RegexOption.IGNORE_CASE).containsMatchIn(it) }
        val text2 = when {
            fields.isNotEmpty() -> fields.values.first()
            russian != null -> russian
            status == 400 && text.contains("authenticate") -> "Неверное @имя или пароль"
            status == 401 -> "Нужно войти заново"
            status == 403 -> "Нет доступа"
            status == 404 -> "Не найдено"
            status == 429 -> "Слишком много запросов. Подождите минуту."
            status >= 500 -> "Ошибка на сервере. Попробуйте позже."
            else -> "Что-то пошло не так (код $status)"
        }
        return ApiException(text2, status, fields)
    }

    private fun fieldMessage(field: String, code: String) = when {
        field == "username" && code == "validation_not_unique" -> "Это @имя уже занято"
        field == "username" -> "@имя: от 3 до 32 латинских букв, цифр или _"
        field == "password" && code == "validation_values_mismatch" -> "Пароли не совпадают"
        field == "password" -> "Пароль: не меньше 8 символов"
        field == "name" -> "Впишите имя"
        field == "oldPassword" -> "Неверный текущий пароль"
        else -> "Проверьте поле «$field»"
    }

    companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
