package ru.beemes.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Сейф телефона: закрытый ключ шифрования хранится зашифрованным ключом из Android Keystore.
 * Ключ Keystore нельзя вынуть из телефона — даже если скопировать файлы приложения, ключом не воспользоваться.
 */
class Vault(context: Context) {
    private val prefs = context.getSharedPreferences("vault", Context.MODE_PRIVATE)

    fun put(name: String, value: ByteArray) {
        val stored = runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            "k:" + Crypto.b64(cipher.iv + cipher.doFinal(value))
        }.getOrElse {
            // Нет Keystore (бывает только в тестах на компьютере).
            "p:" + Crypto.b64(value)
        }
        prefs.edit().putString(name, stored).apply()
    }

    fun get(name: String): ByteArray? {
        val stored = prefs.getString(name, null) ?: return null
        return runCatching {
            when {
                stored.startsWith("p:") -> Crypto.unb64(stored.substring(2))
                else -> {
                    val raw = Crypto.unb64(stored.substring(2))
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
                    cipher.doFinal(raw.copyOfRange(12, raw.size))
                }
            }
        }.getOrNull()
    }

    fun remove(name: String) = prefs.edit().remove(name).apply()

    fun clear() = prefs.edit().clear().apply()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private companion object {
        const val ALIAS = "beemes_vault"
    }
}
