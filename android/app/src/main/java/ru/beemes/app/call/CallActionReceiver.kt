package ru.beemes.app.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch
import ru.beemes.app.BeemesApp
import ru.beemes.app.push.Notifier

/** Кнопки «Ответить» и «Отклонить» в уведомлении о звонке. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val repo = (context.applicationContext as BeemesApp).repository
        val call = intent.getStringExtra(IncomingCallActivity.CALL).orEmpty()
        val chat = intent.getStringExtra(IncomingCallActivity.CHAT).orEmpty()
        val from = intent.getStringExtra(IncomingCallActivity.FROM).orEmpty()
        val video = intent.getBooleanExtra(IncomingCallActivity.VIDEO, false)
        Notifier.cancelCall(context, call)
        IncomingCallActivity.finishCall(call)
        when (intent.action) {
            ANSWER -> CallActivity.open(context, repo.callUrl(chat, video, call), chat)
            DECLINE -> {
                val done = goAsync()
                repo.scope.launch { repo.declineCall(chat, call, from); done.finish() }
            }
        }
    }

    companion object {
        const val ANSWER = "ru.beemes.app.ANSWER"
        const val DECLINE = "ru.beemes.app.DECLINE"
    }
}
