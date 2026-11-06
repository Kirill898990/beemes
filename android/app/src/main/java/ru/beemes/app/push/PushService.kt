package ru.beemes.app.push

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import ru.beemes.app.BeemesApp
import ru.beemes.app.call.IncomingCallActivity

/**
 * Push-уведомления Firebase. В уведомлении сообщение зашифровано — телефон расшифровывает его сам,
 * Google текста не видит.
 */
class PushService : FirebaseMessagingService() {
    private val app get() = application as BeemesApp

    override fun onNewToken(token: String) {
        app.repository.scope.launch { runCatching { app.repository.registerPush(token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val repo = app.repository
        if (!repo.signedIn) return
        when (d["type"]) {
            "msg" -> {
                val chatId = d["chat"].orEmpty()
                // Чат открыт на экране — уведомление не нужно (сообщение придёт само).
                if (app.inForeground && repo.openChatId == chatId) return
                if (!repo.notificationsEnabled) return
                val content = d["body"]?.takeIf { it.isNotBlank() }?.let {
                    repo.decryptPush(chatId, d["sender"].orEmpty(), d["senderKey"].orEmpty(), it, d["nonce"].orEmpty())
                }
                val text = when {
                    d["kind"] == "photo" -> "📷 " + (content?.c ?: "Фото")
                    d["kind"] == "call" -> "📞 Звонок"
                    content?.t != null -> content.t
                    else -> "Новое сообщение"
                }
                Notifier.message(this, chatId, d["senderName"].orEmpty(), text, quiet = d["silent"] == "1")
                if (app.inForeground) repo.scope.launch { runCatching { repo.refreshChats() } }
            }
            "call" -> {
                val callId = d["call"].orEmpty()
                val extras = IncomingCallActivity.extras(callId, d["chat"].orEmpty(), d["from"].orEmpty(), d["name"].orEmpty(), d["video"] == "1")
                if (IncomingCallActivity.isShowing(callId)) {
                    // уже звоним на экране
                } else if (app.inForeground) {
                    startActivity(Intent(this, IncomingCallActivity::class.java).putExtras(extras).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } else {
                    Notifier.incomingCall(this, callId, d["chat"].orEmpty(), d["from"].orEmpty(), d["name"].orEmpty(), d["video"] == "1")
                }
            }
            "call_end" -> {
                val callId = d["call"].orEmpty()
                Notifier.cancelCall(this, callId)
                IncomingCallActivity.finishCall(callId)
            }
        }
    }
}
