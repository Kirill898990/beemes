package ru.beemes.app.push

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import ru.beemes.app.MainActivity
import ru.beemes.app.R
import ru.beemes.app.call.CallActionReceiver
import ru.beemes.app.call.IncomingCallActivity

/** Уведомления: сообщения (по чатам) и входящие звонки на весь экран. */
object Notifier {
    const val CH_MESSAGES = "messages"
    const val CH_QUIET = "quiet"
    const val CH_CALLS = "calls"
    const val EXTRA_CHAT = "chat"
    private const val HONEY = 0xFFFFB627.toInt()

    fun createChannels(context: Context) {
        val m = NotificationManagerCompat.from(context)
        m.createNotificationChannel(
            NotificationChannelCompat.Builder(CH_MESSAGES, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Сообщения").setDescription("Новые сообщения в чатах").build(),
        )
        m.createNotificationChannel(
            NotificationChannelCompat.Builder(CH_QUIET, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName("Чаты без звука").setDescription("Сообщения из чатов, где выключен звук").build(),
        )
        m.createNotificationChannel(
            NotificationChannelCompat.Builder(CH_CALLS, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Звонки").setDescription("Входящие звонки")
                .setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
                .setVibrationEnabled(true).setVibrationPattern(longArrayOf(0, 800, 600, 800, 600))
                .build(),
        )
    }

    fun allowed(context: Context) = (Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun openChat(context: Context, chatId: String) = PendingIntent.getActivity(
        context, chatId.hashCode(),
        Intent(context, MainActivity::class.java).putExtra(EXTRA_CHAT, chatId).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** Сообщение: одно уведомление на чат, новые строки добавляются (стиль переписки). */
    fun message(context: Context, chatId: String, senderName: String, text: String, quiet: Boolean) {
        if (!allowed(context)) return
        val m = NotificationManagerCompat.from(context)
        val id = chatId.hashCode()
        val person = Person.Builder().setName(senderName).setKey(chatId).build()
        val previous = m.activeNotifications.firstOrNull { it.id == id }?.notification
        val style = previous?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it) }
            ?: NotificationCompat.MessagingStyle(Person.Builder().setName("Вы").build())
        style.addMessage(text, System.currentTimeMillis(), person)
        val n = NotificationCompat.Builder(context, if (quiet) CH_QUIET else CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(HONEY)
            .setStyle(style)
            .setContentIntent(openChat(context, chatId))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setOnlyAlertOnce(false)
            .build()
        try { m.notify(id, n) } catch (_: SecurityException) {}
    }

    /** Пробное уведомление: «Уведомления работают». */
    fun test(context: Context) {
        if (!allowed(context)) return
        val open = PendingIntent.getActivity(
            context, 7, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(HONEY)
            .setContentTitle("Уведомления работают 🐝")
            .setContentText("Так будут приходить новые сообщения и звонки.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(context).notify(7, n) } catch (_: SecurityException) {}
    }

    fun clearChat(context: Context, chatId: String) = NotificationManagerCompat.from(context).cancel(chatId.hashCode())

    /** Входящий звонок: на весь экран (на заблокированном телефоне тоже), с кнопками «Ответить» и «Отклонить». */
    fun incomingCall(context: Context, callId: String, chatId: String, from: String, name: String, video: Boolean) {
        if (!allowed(context)) return
        val extras = IncomingCallActivity.extras(callId, chatId, from, name, video)
        val full = PendingIntent.getActivity(
            context, callId.hashCode(),
            Intent(context, IncomingCallActivity::class.java).putExtras(extras).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        fun action(kind: String) = PendingIntent.getBroadcast(
            context, (callId + kind).hashCode(),
            Intent(context, CallActionReceiver::class.java).setAction(kind).putExtras(extras),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val caller = Person.Builder().setName(name.ifBlank { "beemes" }).setImportant(true).build()
        val builder = NotificationCompat.Builder(context, CH_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(HONEY)
            .setContentTitle(name.ifBlank { "Входящий звонок" })
            .setContentText(if (video) "Видеозвонок beemes" else "Звонок beemes")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .setOngoing(true)
            .setTimeoutAfter(45_000)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, action(CallActionReceiver.DECLINE), action(CallActionReceiver.ANSWER)).setIsVideo(video))
        try {
            NotificationManagerCompat.from(context).notify(callId.hashCode(), builder.build().apply { flags = flags or Notification.FLAG_INSISTENT })
        } catch (_: SecurityException) {}
    }

    fun cancelCall(context: Context, callId: String) = NotificationManagerCompat.from(context).cancel(callId.hashCode())
}
