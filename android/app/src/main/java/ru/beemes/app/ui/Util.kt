package ru.beemes.app.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/** Открыть ссылку в браузере. */
fun Context.openUrl(url: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(this, "Нет браузера, чтобы открыть ссылку", Toast.LENGTH_SHORT).show()
    }
}

/** Короткое сообщение внизу экрана — с любого потока (после сетевого запроса тоже). */
fun Context.toast(text: String?) {
    if (text.isNullOrBlank()) return
    val ctx = applicationContext
    android.os.Handler(android.os.Looper.getMainLooper()).post { Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show() }
}
