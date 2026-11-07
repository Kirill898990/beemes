package ru.beemes.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import ru.beemes.app.data.Crypto
import java.util.Base64

/** Вход по QR-коду: ключ переписки, зашифрованный сайтом, открывается в приложении, и наоборот. */
class QrCryptoTest {
    @Before fun base64() {
        Crypto.base64Encoder = { Base64.getEncoder().encodeToString(it) }
        Crypto.base64Decoder = { Base64.getDecoder().decode(it) }
    }

    private val raw = ByteArray(32) { (it * 7 + 1).toByte() }

    /** Запечатано сайтом (crypto.js qrSeal) для временного ключа priv. */
    @Test fun opensWhatWebSealed() {
        val priv = Crypto.unb64("+Be8t7vDfPqEc7t99mVI2cOLethsibGijXw66KL1YVo=")
        val out = Crypto.qrOpen(priv, "bj/4StP+fqZ5XNYauuh79QvWzjH8r+WS8aaCM6BLoUw=", "abc123qrid", "uF9vvj1RJAO/rAl98kIgV2CDLzm6IhJwlmvcNcxMe6ZxEWJmeZt1Pgbs1cB/xNif", "HopulaCGtSxYXrfx")
        assertArrayEquals(raw, out)
    }

    @Test fun sealAndOpen() {
        val eph = Crypto.newIdentity()
        val s = Crypto.qrSeal(eph.publicKey, "qr1", raw)
        assertArrayEquals(raw, Crypto.qrOpen(eph.privateKey, s.e2pub, "qr1", s.body, s.nonce))
        // другой id входа (или чужой ключ) — не откроется
        assertThrows(Exception::class.java) { Crypto.qrOpen(eph.privateKey, s.e2pub, "qr2", s.body, s.nonce) }
        assertThrows(Exception::class.java) { Crypto.qrOpen(Crypto.newIdentity().privateKey, s.e2pub, "qr1", s.body, s.nonce) }
    }

    @Test fun qrLinkKeyRoundTrip() {
        val eph = Crypto.newIdentity()
        assertArrayEquals(eph.publicKey, Crypto.unb64url(Crypto.b64url(eph.publicKey)))
    }
}
