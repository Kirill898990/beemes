package ru.beemes.app

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.beemes.app.data.User
import ru.beemes.app.data.lastSeenText
import java.time.Instant

/** «В сети»: по onlineUntil с сервера, а у старого сервера — по lastSeen (2 минуты). */
class PresenceTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun at(ms: Long) = Instant.ofEpochMilli(ms).toString().replace('T', ' ')
    private val now = 1_790_000_000_000L

    @Test fun onlineWhileOnlineUntilInFuture() {
        val u = User(id = "a", onlineUntil = at(now + 30_000), lastSeen = at(now - 5_000))
        assertTrue(u.onlineAt(now))
        assertEquals("в сети", lastSeenText(u, now))
    }

    @Test fun offlineRightAfterLeaving() {
        // вышел 3 секунды назад: сервер поставил onlineUntil = время выхода
        val u = User(id = "a", onlineUntil = at(now - 3_000), lastSeen = at(now - 3_000))
        assertFalse(u.onlineAt(now))
        assertEquals("был(а) только что", lastSeenText(u, now))
        assertEquals("был(а) 5 мин. назад", lastSeenText(u.copy(lastSeen = at(now - 300_000)), now))
    }

    @Test fun expiresWithoutGoodbye() {
        val u = User(id = "a", onlineUntil = at(now + 1_000))
        assertTrue(u.onlineAt(now))
        assertFalse(u.onlineAt(now + 1_001))
    }

    @Test fun oldServerFallsBackToLastSeen() {
        assertTrue(User(id = "a", lastSeen = at(now - 60_000)).onlineAt(now))
        assertFalse(User(id = "a", lastSeen = at(now - 180_000)).onlineAt(now))
    }

    @Test fun hiddenLastSeen() {
        val u = User(id = "a", hideLastSeen = true)
        assertFalse(u.onlineAt(now))
        assertEquals("был(а) недавно", lastSeenText(u, now))
    }

    @Test fun realtimeRecordDecodes() {
        val record = """{"collectionId":"_pb_users_auth_","collectionName":"users","id":"abc","username":"alisa","name":"Алиса",
            |"onlineUntil":"2026-11-07 10:00:45.000Z","lastSeen":"2026-11-07 10:00:00.000Z","hideLastSeen":false,"verified":false}""".trimMargin()
        val u = json.decodeFromString(User.serializer(), record)
        assertEquals("abc", u.id)
        assertEquals(Instant.parse("2026-11-07T10:00:45Z").toEpochMilli(), u.onlineUntilMillis)
    }
}
