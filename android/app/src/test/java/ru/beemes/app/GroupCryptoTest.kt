package ru.beemes.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import ru.beemes.app.data.Crypto
import java.util.Base64

/** Ключ группы: зашифровать для участника и расшифровать им самим (так же делают сайт и тест сервера). */
class GroupCryptoTest {
    @Before fun base64() {
        Crypto.base64Encoder = { Base64.getEncoder().encodeToString(it) }
        Crypto.base64Decoder = { Base64.getDecoder().decode(it) }
    }

    @Test fun wrapForMemberAndUnwrap() {
        val alice = Crypto.newIdentity()
        val bob = Crypto.newIdentity()
        val k = Crypto.newGroupKey()
        val w = Crypto.wrapGroupKey(alice.privateKey, bob.publicKey, "chat1", 2, "bob", k)
        assertArrayEquals(k, Crypto.unwrapGroupKey(bob.privateKey, alice.publicKey, "chat1", 2, "bob", w.body, w.nonce))
    }

    @Test fun wrongEpochOrUserFails() {
        val alice = Crypto.newIdentity()
        val bob = Crypto.newIdentity()
        val w = Crypto.wrapGroupKey(alice.privateKey, bob.publicKey, "chat1", 2, "bob", Crypto.newGroupKey())
        assertThrows(Exception::class.java) { Crypto.unwrapGroupKey(bob.privateKey, alice.publicKey, "chat1", 3, "bob", w.body, w.nonce) }
        assertThrows(Exception::class.java) { Crypto.unwrapGroupKey(bob.privateKey, alice.publicKey, "chat1", 2, "carol", w.body, w.nonce) }
    }

    @Test fun selfWrapForOwnDevices() {
        val me = Crypto.newIdentity()
        val k = Crypto.newGroupKey()
        val w = Crypto.wrapGroupKey(me.privateKey, me.publicKey, "g", 1, "me", k)
        assertArrayEquals(k, Crypto.unwrapGroupKey(me.privateKey, me.publicKey, "g", 1, "me", w.body, w.nonce))
    }

    @Test fun inviteKeyInLink() {
        val k = Crypto.newGroupKey()
        val s = Crypto.b64url(k)
        assertEquals(43, s.length)
        assertArrayEquals(k, Crypto.unb64url(s))
    }
}
