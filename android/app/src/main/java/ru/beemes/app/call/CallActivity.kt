package ru.beemes.app.call

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import kotlinx.coroutines.launch
import ru.beemes.app.BeemesApp
import ru.beemes.app.BuildConfig

/*
 * Звонок: страница call.html с сервера beemes (WebRTC). Голос и видео идут напрямую между телефонами
 * и шифруются (DTLS-SRTP). Приложение даёт странице микрофон и камеру и включает громкую связь.
 */
class CallActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pending: PermissionRequest? = null
    private val audio by lazy { getSystemService(AudioManager::class.java) }
    private var oldMode = AudioManager.MODE_NORMAL
    private var speakerWanted = true
    private var chatId = ""

    private val ask = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pending?.let { answer(it) }
        pending = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        chatId = intent.getStringExtra(EXTRA_CHAT).orEmpty()
        if (!url.startsWith(BuildConfig.SERVER_URL.trimEnd('/'))) { finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this).apply {
            setBackgroundColor(0xFF100E17.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val missing = needed(request).filter { !granted(it) }
                        if (missing.isEmpty()) answer(request) else { pending = request; ask.launch(missing.toTypedArray()) }
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url.toString()
                    if (target.startsWith(BuildConfig.SERVER_URL.trimEnd('/') + "/call.html")) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, target.toUri())) }
                    return true
                }
            }
            addJavascriptInterface(Bridge(), "BeemesCall")
        }
        setContentView(web)
        oldMode = audio.mode
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        setSpeaker(true)
        volumeControlStream = AudioManager.STREAM_VOICE_CALL
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.BeemesCallPage && window.BeemesCallPage.hangup()") { finish() }
            }
        })
        web.loadUrl(url)
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            web.evaluateJavascript("window.BeemesCallPage && window.BeemesCallPage.hangup()", null)
            web.destroy()
            setSpeaker(false)
            audio.mode = oldMode
        }
        super.onDestroy()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun needed(r: PermissionRequest) = r.resources.mapNotNull {
        when (it) {
            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
            else -> null
        }
    }

    private fun answer(r: PermissionRequest) {
        val ok = r.resources.filter {
            (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && granted(Manifest.permission.RECORD_AUDIO)) ||
                (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && granted(Manifest.permission.CAMERA))
        }
        if (ok.isEmpty()) r.deny() else r.grant(ok.toTypedArray())
    }

    private fun setSpeaker(on: Boolean) {
        val headset = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }
        val speaker = on && !headset
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (speaker) audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }?.let { audio.setCommunicationDevice(it) }
            else audio.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audio.isSpeakerphoneOn = speaker
        }
    }

    /** Что страница звонка может вызвать в приложении. */
    inner class Bridge {
        @JavascriptInterface fun close() = runOnUiThread { finish() }

        @JavascriptInterface fun setSpeakerOn(on: Boolean) = runOnUiThread { speakerWanted = on; setSpeaker(on) }

        @JavascriptInterface fun reapplySpeaker() = runOnUiThread { audio.mode = AudioManager.MODE_IN_COMMUNICATION; setSpeaker(speakerWanted) }

        @JavascriptInterface fun isSpeakerOn(): Boolean =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            else @Suppress("DEPRECATION") audio.isSpeakerphoneOn

        /** Звонок закончился — звонивший оставляет в чате запись о звонке (зашифрованную). */
        @JavascriptInterface fun ended(video: Boolean, seconds: Int, status: String) {
            val repo = (application as BeemesApp).repository
            if (chatId.isBlank()) return
            repo.scope.launch { repo.sendCallLog(chatId, video, seconds, status) }
        }
    }

    companion object {
        private const val EXTRA_URL = "url"
        private const val EXTRA_CHAT = "chat"

        fun open(context: Context, url: String, chatId: String) {
            context.startActivity(
                Intent(context, CallActivity::class.java).putExtra(EXTRA_URL, url).putExtra(EXTRA_CHAT, chatId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
