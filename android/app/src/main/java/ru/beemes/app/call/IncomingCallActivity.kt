package ru.beemes.app.call

import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.beemes.app.BeemesApp
import ru.beemes.app.data.User
import ru.beemes.app.push.Notifier
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.theme.BeemesTheme
import java.lang.ref.WeakReference

/** Входящий звонок на весь экран: имя, «Ответить» и «Отклонить». Звонит мелодия телефона. */
class IncomingCallActivity : ComponentActivity() {
    private var ringtone: Ringtone? = null
    private var callId = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val repo = (application as BeemesApp).repository
        callId = intent.getStringExtra(CALL).orEmpty()
        val chat = intent.getStringExtra(CHAT).orEmpty()
        val from = intent.getStringExtra(FROM).orEmpty()
        val name = intent.getStringExtra(NAME).orEmpty()
        val video = intent.getBooleanExtra(VIDEO, false)
        active[callId] = WeakReference(this)
        Notifier.cancelCall(this, callId)
        ringtone = runCatching { RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.also { it.play() } }.getOrNull()
        setContent {
            BeemesTheme(dark = true) {
                var caller by remember { mutableStateOf(repo.users.value[from] ?: User(id = from, name = name)) }
                LaunchedEffect(from) { runCatching { caller = repo.user(from) } }
                LaunchedEffect(Unit) { delay(45_000); finish() }
                IncomingCallScreen(
                    caller = caller,
                    video = video,
                    onAnswer = {
                        CallActivity.open(this, repo.callUrl(chat, video, callId), chat)
                        finish()
                    },
                    onDecline = {
                        repo.scope.launch { repo.declineCall(chat, callId, from) }
                        finish()
                    },
                )
            }
        }
    }

    override fun onDestroy() {
        runCatching { ringtone?.stop() }
        active.remove(callId)
        super.onDestroy()
    }

    companion object {
        const val CALL = "call"
        const val CHAT = "chat"
        const val FROM = "from"
        const val NAME = "name"
        const val VIDEO = "video"
        private val active = mutableMapOf<String, WeakReference<IncomingCallActivity>>()

        fun extras(call: String, chat: String, from: String, name: String, video: Boolean) = Bundle().apply {
            putString(CALL, call); putString(CHAT, chat); putString(FROM, from); putString(NAME, name); putBoolean(VIDEO, video)
        }

        /** Это окно звонка уже открыто (push и realtime могут сообщить об одном звонке дважды). */
        fun isShowing(call: String) = active[call]?.get() != null

        /** Звонок закончился (звонивший положил трубку или ответили на другом телефоне). */
        fun finishCall(call: String) {
            active[call]?.get()?.let { a -> a.runOnUiThread { a.finish() } }
        }
    }
}

@Composable
fun IncomingCallScreen(caller: User, video: Boolean, onAnswer: () -> Unit, onDecline: () -> Unit) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val scale by pulse.animateFloat(1f, 1.12f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "scale")
    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF2A2140), Color(0xFF100E17)))),
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(72.dp))
            Box(Modifier.scale(scale)) { Avatar(caller, size = 132.dp) }
            Spacer(Modifier.height(24.dp))
            Text(caller.title, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(if (video) "Видеозвонок beemes" else "Звонок beemes", color = Color(0xFFB8B2CC), fontSize = 16.sp)
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(bottom = 32.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallButton("Отклонить", Color(0xFFE5383B), onDecline) { Icon(Icons.Filled.CallEnd, null, tint = Color.White, modifier = Modifier.size(32.dp)) }
                CallButton("Ответить", Color(0xFF1E9E57), onAnswer) {
                    Icon(if (video) Icons.Filled.Videocam else Icons.Filled.Call, null, tint = Color.White, modifier = Modifier.size(32.dp))
                }
            }
        }
    }
}

@Composable
private fun CallButton(label: String, color: Color, onClick: () -> Unit, icon: @Composable () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick,
            modifier = Modifier.size(76.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color),
        ) { icon() }
        Spacer(Modifier.height(10.dp))
        Text(label, color = Color.White, fontSize = 15.sp)
    }
}
