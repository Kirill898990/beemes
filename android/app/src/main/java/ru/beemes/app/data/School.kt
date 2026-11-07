package ru.beemes.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ru.beemes.app.BuildConfig
import java.time.Instant

/**
 * Учебный профиль «Простой химии»: вход аккаунтом школьного сайта и оценки за работы.
 *
 * Оценки приходят с сайта «Простой химии» прямо на телефон — на сервер beemes они не попадают,
 * и их видит только владелец телефона. Пароль не сохраняется: хранится только вход (токен),
 * зашифрованный ключом телефона. Выход из beemes отключает и учебный профиль.
 */
class School(context: Context, private val vault: Vault) {
    @Serializable
    data class Student(
        val id: String = "",
        val username: String = "",
        val name: String = "",
        val group: String = "",
        val isTeacher: Boolean = false,
    )

    @Serializable
    data class PracticeInfo(val subject: String = "", val exam: Boolean = false, val enrollment: String = "")

    @Serializable
    data class WorkExpand(val practice: PracticeInfo? = null)

    @Serializable
    data class Work(
        val id: String = "",
        val practiceTitle: String = "",
        val solved: Int = 0,
        val total: Int = 0,
        /** 0 — ещё не проверено, иначе оценка 1–5. */
        val grade: Int = 0,
        val comment: String = "",
        val gradedAt: String = "",
        val created: String = "",
        val overtime: Boolean = false,
        val expand: WorkExpand? = null,
    ) {
        val graded: Boolean get() = grade > 0
        val exam: Boolean get() = expand?.practice?.exam == true
        val course: Boolean get() = expand?.practice?.enrollment?.isNotBlank() == true
        val subject: String get() = expand?.practice?.subject.orEmpty()
        val createdAt: Instant? get() = parseTime(created)
    }

    @Serializable private data class Auth(val token: String = "", val record: Student = Student())
    @Serializable private data class Works(val items: List<Work> = emptyList(), val totalPages: Int = 1)

    private val prefs = context.getSharedPreferences("school", Context.MODE_PRIVATE)
    private val api = Api(BuildConfig.SCHOOL_URL, token = { token() })
    private val json get() = api.json

    private val _student = MutableStateFlow(prefs.getString(KEY_STUDENT, null)?.let { runCatching { json.decodeFromString(Student.serializer(), it) }.getOrNull() })
    /** Подключённый аккаунт «Простой химии» (null — не подключён). */
    val student: StateFlow<Student?> = _student.asStateFlow()

    private val _works = MutableStateFlow(prefs.getString(KEY_WORKS, null)?.let { runCatching { json.decodeFromString(ListSerializer(Work.serializer()), it) }.getOrNull() } ?: emptyList())
    /** Работы с оценками (последние сверху). Хранятся на телефоне — видно и без интернета. */
    val works: StateFlow<List<Work>> = _works.asStateFlow()

    val siteUrl: String get() = BuildConfig.SCHOOL_URL.trimEnd('/')

    private fun token(): String? = vault.get(KEY_TOKEN)?.toString(Charsets.UTF_8)

    /** Войти логином и паролем «Простой химии». */
    suspend fun connect(login: String, password: String) {
        val auth = school {
            api.send(
                "POST", "api/collections/users/auth-with-password", Auth.serializer(),
                buildJsonObject { put("identity", login.trim().lowercase()); put("password", password) },
            )
        }
        save(auth)
        refresh()
    }

    /** Обновить оценки (и продлить вход). */
    suspend fun refresh() {
        if (token() == null) return
        val auth = school { api.send("POST", "api/collections/users/auth-refresh", Auth.serializer()) }
        save(auth)
        if (auth.record.isTeacher) {
            setWorks(emptyList())
            return
        }
        val all = mutableListOf<Work>()
        var page = 1
        do {
            val result = school {
                api.get(
                    "api/collections/submissions/records", Works.serializer(),
                    mapOf("filter" to "student = \"${auth.record.id}\"", "sort" to "-created", "perPage" to "200", "page" to "$page", "expand" to "practice"),
                )
            }
            all += result.items
            page++
        } while (page <= result.totalPages && page <= 10)
        setWorks(all)
    }

    /** Отключить учебный профиль: забыть вход и оценки на этом телефоне. */
    fun disconnect() {
        vault.remove(KEY_TOKEN)
        prefs.edit().clear().apply()
        _student.value = null
        _works.value = emptyList()
    }

    private fun save(auth: Auth) {
        if (auth.token.isNotBlank()) vault.put(KEY_TOKEN, auth.token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY_STUDENT, json.encodeToString(Student.serializer(), auth.record)).apply()
        _student.value = auth.record
    }

    private fun setWorks(list: List<Work>) {
        prefs.edit().putString(KEY_WORKS, json.encodeToString(ListSerializer(Work.serializer()), list)).apply()
        _works.value = list
    }

    /** Ошибки сайта школы — понятными словами. */
    private suspend fun <T> school(block: suspend () -> T): T = try {
        block()
    } catch (e: ApiException) {
        when {
            e.status == 400 && _student.value == null -> throw ApiException("Неверный логин или пароль «Простой химии»", 400)
            e.status == 401 || (e.status == 403 && token() != null) -> {
                disconnect()
                throw ApiException("Вход в «Простую химию» устарел — подключите профиль заново", 401)
            }
            e.status == 0 -> throw ApiException("Нет связи с сайтом «Простая химия». Проверьте интернет.")
            else -> throw e
        }
    }

    companion object {
        private const val KEY_TOKEN = "school_token"
        private const val KEY_STUDENT = "student"
        private const val KEY_WORKS = "works"

        /** Средняя оценка: «4,6» (или null, если оценок нет). */
        fun average(works: List<Work>): String? {
            val graded = works.filter { it.graded }
            if (graded.isEmpty()) return null
            val avg = graded.sumOf { it.grade }.toDouble() / graded.size
            return String.format(java.util.Locale.forLanguageTag("ru"), "%.1f", avg)
        }
    }
}
