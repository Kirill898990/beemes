package ru.beemes.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import ru.beemes.app.data.Crypto
import java.util.Base64

/**
 * Шифрование телефона совпадает с эталоном (тот же алгоритм на Python, библиотека cryptography):
 * всё, что зашифровал один, расшифрует другой.
 */
class CryptoTest {
    @Before fun base64() {
        Crypto.base64Encoder = { Base64.getEncoder().encodeToString(it) }
        Crypto.base64Decoder = { Base64.getDecoder().decode(it) }
    }

    private val pw = "Пчёлка 🐝 секрет"

    @Test fun authPasswordMatchesReference() {
        assertEquals("b2cF53kRWQwrB0EaBw59WzwfNJJLkr5YIYEoITsj5Ms=", Crypto.authPassword("alice", pw))
        assertEquals(Crypto.authPassword("alice", pw), Crypto.authPassword("Alice", pw))
    }

    @Test fun publicKeyAndChatKeyMatchReference() {
        val a = Crypto.unb64("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=")
        val b = Crypto.unb64("ISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0A=")
        assertEquals("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=", Crypto.b64(Crypto.publicFromPrivate(a)))
        val k1 = Crypto.chatKey(a, Crypto.publicFromPrivate(b), "chat123abc")
        val k2 = Crypto.chatKey(b, Crypto.publicFromPrivate(a), "chat123abc")
        assertEquals("iVd9wglZuwuYJLuLYgZ2lH3bVlf5zlNb3HO3OB0jreM=", Crypto.b64(k1))
        assertArrayEquals("both sides get the same key", k1, k2)
        assertNotEquals(Crypto.b64(k1), Crypto.b64(Crypto.chatKey(a, Crypto.publicFromPrivate(b), "other")))
    }

    @Test fun decryptsMessageFromReference() {
        val k = Crypto.unb64("iVd9wglZuwuYJLuLYgZ2lH3bVlf5zlNb3HO3OB0jreM=")
        val text = String(Crypto.open(k, "UqbANSupIrmpoHA+0rFFHklUjIbGVVFBGxS6YAM4HLRzuyPOm93cRtxy", "AAECAwQFBgcICQoL", "chat123abc|aliceid"))
        assertEquals("{\"t\": \"Привет 🐝\"}", text)
        // Чужой чат или чужой отправитель — не расшифровать.
        assertThrows(Exception::class.java) { Crypto.open(k, "UqbANSupIrmpoHA+0rFFHklUjIbGVVFBGxS6YAM4HLRzuyPOm93cRtxy", "AAECAwQFBgcICQoL", "chat123abc|bob") }
    }

    @Test fun unwrapsPrivateKeyFromReference() {
        val priv = Crypto.unwrapPrivateKey(
            "AAECAwQFBgcICQoLHXfQGS15X+VOwjHca82tmDSUxxaCMY8NpwZGaa3PK9DaVAwsL4yU7h7rZv8mUQXI", "AAECAwQFBgcICQoLDA0ODw==", pw,
        )
        assertEquals("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", Crypto.b64(priv))
        assertThrows(Exception::class.java) {
            Crypto.unwrapPrivateKey("AAECAwQFBgcICQoLHXfQGS15X+VOwjHca82tmDSUxxaCMY8NpwZGaa3PK9DaVAwsL4yU7h7rZv8mUQXI", "AAECAwQFBgcICQoLDA0ODw==", "wrong")
        }
    }

    @Test fun roundTrips() {
        val me = Crypto.newIdentity()
        val (wrapped, salt) = Crypto.wrapPrivateKey(me.privateKey, pw)
        assertArrayEquals(me.privateKey, Crypto.unwrapPrivateKey(wrapped, salt, pw))
        val them = Crypto.newIdentity()
        val key = Crypto.chatKey(me.privateKey, them.publicKey, "c1")
        val sealed = Crypto.seal(key, "секрет".toByteArray(), Crypto.messageAad("c1", "me"))
        assertEquals("секрет", String(Crypto.open(Crypto.chatKey(them.privateKey, me.publicKey, "c1"), sealed.body, sealed.nonce, Crypto.messageAad("c1", "me"))))
        val photo = Crypto.randomBytes(10_000)
        val (blob, fileKey) = Crypto.encryptFile(photo)
        assertArrayEquals(photo, Crypto.decryptFile(blob, fileKey))
        assertEquals(Crypto.safetyCode(me.publicKey, them.publicKey), Crypto.safetyCode(them.publicKey, me.publicKey))
        assertEquals(4, Crypto.safetyCode(me.publicKey, them.publicKey).size)
    }
}
