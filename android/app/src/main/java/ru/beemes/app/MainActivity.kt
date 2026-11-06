package ru.beemes.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.flow.MutableStateFlow
import ru.beemes.app.push.Notifier
import ru.beemes.app.ui.AppNavigation
import ru.beemes.app.ui.theme.BeemesTheme

class MainActivity : ComponentActivity() {
    private val app get() = application as BeemesApp
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        openChat.value = intent.getStringExtra(Notifier.EXTRA_CHAT)
        setContent {
            var theme by androidx.compose.runtime.remember { mutableStateOf(app.repository.theme) }
            val dark = when (theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            BeemesTheme(dark = dark) {
                AppNavigation(app, openChat, onTheme = { theme = it; app.repository.theme = it }, onSignedIn = ::signedIn)
            }
        }
    }

    private fun signedIn() {
        app.onSignedIn()
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Notifier.EXTRA_CHAT)?.let { openChat.value = it }
    }

    /** Чат, который нужно открыть (нажали на уведомление). */
    val openChat = MutableStateFlow<String?>(null)
}
