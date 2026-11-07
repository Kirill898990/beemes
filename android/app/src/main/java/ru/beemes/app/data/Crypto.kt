package ru.beemes.app.data

import android.util.Base64
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/*
 * Сквозное шифрование beemes. Сервер видит только зашифрованные сообщения и фото.
 *
 * • У каждого человека пара ключей X25519. Открытый ключ лежит в профиле, закрытый — только на телефоне
 *   (и на сервере в виде, зашифрованном паролем, чтобы войти с нового телефона).
 * • Ключ чата: X25519(мой закрытый, открытый собеседника) → HKDF-SHA256 (соль — id чата). Оба собеседника
 *   получают один и тот же ключ, а сервер — нет.
 * • Сообщение: AES-256-GCM со случайным одноразовым числом; к шифру привязаны id чата и отправителя
 *   (нельзя переложить сообщение в другой чат или выдать за чужое).
 * • Фото: свой случайный ключ на каждый файл, ключ — внутри зашифрованного сообщения.
 * • Пароль: на сервер уходит не сам пароль, а PBKDF2(пароль, «beemes-auth|@имя»). Закрытый ключ
 *   шифруется другим ключом из пароля — PBKDF2(пароль, случайная соль). Сервер не может узнать ни пароль,
 *   ни закрытый ключ.
 *
 * Тот же алгоритм проверен в тесте сервера (Python, библиотека cryptography).
 */
object Crypto {
    const val ITERATIONS = 210_000
    private val random = SecureRandom()

    fun randomBytes(n: Int) = ByteArray(n).also { random.nextBytes(it) }

    // ---------- Base64 (без переносов строк) ----------
    var base64Encoder: (ByteArray) -> String = { Base64.encodeToString(it, Base64.NO_WRAP) }
    var base64Decoder: (String) -> ByteArray = { Base64.decode(it, Base64.NO_WRAP) }
    fun b64(bytes: ByteArray) = base64Encoder(bytes)
    fun unb64(text: String) = base64Decoder(text)

    // ---------- Ключи ----------
    class Identity(val privateKey: ByteArray, val publicKey: ByteArray)

    fun newIdentity(): Identity {
        val priv = X25519.generatePrivateKey()
        return Identity(priv, X25519.publicFromPrivate(priv))
    }

    fun publicFromPrivate(priv: ByteArray): ByteArray = X25519.publicFromPrivate(priv)

    /** PBKDF2-HMAC-SHA256 (пароль в UTF-8 — одинаково на любом телефоне). */
    fun pbkdf2(password: String, salt: ByteArray, iterations: Int = ITERATIONS, length: Int = 32): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        // Пустой ключ HMAC равен ключу из одного нулевого байта (HMAC дополняет ключ нулями).
        val pw = password.toByteArray(Charsets.UTF_8).let { if (it.isEmpty()) ByteArray(1) else it }
        mac.init(SecretKeySpec(pw, "HmacSHA256"))
        val out = ByteArray(length)
        var block = 1
        var offset = 0
        while (offset < length) {
            mac.update(salt)
            mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
            var u = mac.doFinal()
            val t = u.copyOf()
            for (i in 1 until iterations) {
                u = mac.doFinal(u)
                for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
            }
            val n = minOf(t.size, length - offset)
            System.arraycopy(t, 0, out, offset, n)
            offset += n
            block++
        }
        return out
    }

    /** То, что уходит на сервер вместо пароля. */
    fun authPassword(username: String, password: String): String =
        b64(pbkdf2(password, "beemes-auth|${username.lowercase()}".toByteArray(Charsets.UTF_8)))

    /** Закрытый ключ, зашифрованный паролем: (wrappedKey, salt) в base64. */
    fun wrapPrivateKey(priv: ByteArray, password: String): Pair<String, String> {
        val salt = randomBytes(16)
        val key = pbkdf2(password, salt)
        val nonce = randomBytes(12)
        return b64(nonce + aesGcm(Cipher.ENCRYPT_MODE, key, nonce, priv, KEY_AAD)) to b64(salt)
    }

    /** Достать закрытый ключ паролем (вход на новом телефоне). Неверный пароль — исключение. */
    fun unwrapPrivateKey(wrapped: String, salt: String, password: String): ByteArray {
        val raw = unb64(wrapped)
        val key = pbkdf2(password, unb64(salt))
        return aesGcm(Cipher.DECRYPT_MODE, key, raw.copyOfRange(0, 12), raw.copyOfRange(12, raw.size), KEY_AAD)
    }

    /** Общий ключ личного чата (у обоих собеседников одинаковый). */
    fun chatKey(myPrivate: ByteArray, theirPublic: ByteArray, chatId: String): ByteArray =
        Hkdf.computeHkdf("HMACSHA256", X25519.computeSharedSecret(myPrivate, theirPublic), chatId.toByteArray(), CHAT_INFO, 32)

    // ---------- Сообщения ----------
    class Sealed(val body: String, val nonce: String)

    fun seal(key: ByteArray, plaintext: ByteArray, aad: String): Sealed {
        val nonce = randomBytes(12)
        return Sealed(b64(aesGcm(Cipher.ENCRYPT_MODE, key, nonce, plaintext, aad.toByteArray())), b64(nonce))
    }

    fun open(key: ByteArray, body: String, nonce: String, aad: String): ByteArray =
        aesGcm(Cipher.DECRYPT_MODE, key, unb64(nonce), unb64(body), aad.toByteArray())

    /** Привязка сообщения к чату и отправителю. */
    fun messageAad(chatId: String, senderId: String) = "$chatId|$senderId"

    // ---------- Файлы ----------
    /** → (зашифрованный файл: 12 байт числа + шифр, ключ файла). */
    fun encryptFile(bytes: ByteArray): Pair<ByteArray, ByteArray> {
        val key = randomBytes(32)
        val nonce = randomBytes(12)
        return (nonce + aesGcm(Cipher.ENCRYPT_MODE, key, nonce, bytes, null)) to key
    }

    fun decryptFile(blob: ByteArray, key: ByteArray): ByteArray =
        aesGcm(Cipher.DECRYPT_MODE, key, blob.copyOfRange(0, 12), blob.copyOfRange(12, blob.size), null)

    // ---------- Код безопасности ----------
    /**
     * Код, который собеседники сравнивают при встрече или по видео: если он совпадает, сервер не подменил ключи.
     * Одинаков у обоих (ключи сортируются). → 20 цифр группами по 5.
     */
    fun safetyCode(a: ByteArray, b: ByteArray): List<String> {
        val (x, y) = if (b64(a) < b64(b)) a to b else b to a
        val hash = MessageDigest.getInstance("SHA-256").digest("beemes-safety-v1".toByteArray() + x + y)
        return (0 until 4).map { i ->
            val n = ((hash[i * 4].toLong() and 0xff) shl 24) or ((hash[i * 4 + 1].toLong() and 0xff) shl 16) or
                ((hash[i * 4 + 2].toLong() and 0xff) shl 8) or (hash[i * 4 + 3].toLong() and 0xff)
            (n % 100_000).toString().padStart(5, '0')
        }
    }

    private fun aesGcm(mode: Int, key: ByteArray, nonce: ByteArray, data: ByteArray, aad: ByteArray?): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        if (aad != null) cipher.updateAAD(aad)
        return cipher.doFinal(data)
    }

    private val KEY_AAD = "beemes-key-v1".toByteArray()
    private val CHAT_INFO = "beemes-chat-v1".toByteArray()
    private val GROUP_INFO = "beemes-group-key-v1".toByteArray()

    // ---------- Группы и каналы ----------
    // Ключ группы — 32 случайных байта (у каждой эпохи свой). Участнику он передаётся зашифрованным лично для него:
    // X25519(от кого, кому) → HKDF(соль «group|чат|эпоха») → AES-GCM. Так же делают сайт (crypto.js) и тесты сервера.
    fun newGroupKey(): ByteArray = randomBytes(32)

    private fun groupWrapKey(myPrivate: ByteArray, theirPublic: ByteArray, chatId: String, epoch: Int): ByteArray =
        Hkdf.computeHkdf("HMACSHA256", X25519.computeSharedSecret(myPrivate, theirPublic), "group|$chatId|$epoch".toByteArray(), GROUP_INFO, 32)

    fun wrapGroupKey(myPrivate: ByteArray, theirPublic: ByteArray, chatId: String, epoch: Int, userId: String, raw: ByteArray): Sealed =
        seal(groupWrapKey(myPrivate, theirPublic, chatId, epoch), raw, "$chatId|$epoch|$userId")

    fun unwrapGroupKey(myPrivate: ByteArray, fromPublic: ByteArray, chatId: String, epoch: Int, userId: String, body: String, nonce: String): ByteArray =
        open(groupWrapKey(myPrivate, fromPublic, chatId, epoch), body, nonce, "$chatId|$epoch|$userId")

    // ---------- Вход по QR-коду ----------
    // Новое устройство показывает в QR временный открытый ключ. Телефон шифрует для него ключ переписки:
    // X25519(временный ключ телефона, ключ из QR) → HKDF(соль «qr|id») → AES-GCM. Так же делает сайт.
    private val QR_INFO = "beemes-qr-v1".toByteArray()
    class QrSealed(val e2pub: String, val body: String, val nonce: String)
    fun qrSeal(theirPublic: ByteArray, id: String, raw: ByteArray): QrSealed {
        val e2 = newIdentity()
        val key = Hkdf.computeHkdf("HMACSHA256", X25519.computeSharedSecret(e2.privateKey, theirPublic), "qr|$id".toByteArray(), QR_INFO, 32)
        val sealed = seal(key, raw, id)
        return QrSealed(b64(e2.publicKey), sealed.body, sealed.nonce)
    }
    /** Новое устройство открывает ключ переписки своим временным закрытым ключом. */
    fun qrOpen(myPrivate: ByteArray, e2pub: String, id: String, body: String, nonce: String): ByteArray {
        val key = Hkdf.computeHkdf("HMACSHA256", X25519.computeSharedSecret(myPrivate, unb64(e2pub)), "qr|$id".toByteArray(), QR_INFO, 32)
        return open(key, body, nonce, id)
    }

    fun b64url(bytes: ByteArray) = b64(bytes).replace('+', '-').replace('/', '_').trimEnd('=')
    fun unb64url(text: String) = unb64(text.replace('-', '+').replace('_', '/').let { it + "=".repeat((4 - it.length % 4) % 4) })
}
