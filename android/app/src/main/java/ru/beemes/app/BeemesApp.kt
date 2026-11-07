package ru.beemes.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ru.beemes.app.data.Emoji
import ru.beemes.app.data.Repository
import ru.beemes.app.push.Notifier

class BeemesApp : Application() {
    lateinit var repository: Repository
        private set

    @Volatile var inForeground = false
        private set
    private var pinger: Job? = null

    override fun onCreate() {
        super.onCreate()
        repository = Repository(this)
        repo = repository
        Emoji.load(this)
        Notifier.createChannels(this)
        // Пока приложение на экране: события сразу (realtime) и «в сети». Свернули или закрыли — сразу «не в сети».
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                inForeground = true
                if (repository.signedIn) onSignedIn()
            }

            override fun onStop(owner: LifecycleOwner) {
                inForeground = false
                pinger?.cancel()
                repository.stopPresenceClock()
                repository.realtime.stop()
                if (repository.signedIn) repository.scope.launch { repository.presence(false) }
            }
        })
    }

    /** Вошли (или открыли приложение, уже войдя): связь в реальном времени, «в сети», push. */
    fun onSignedIn() {
        repository.realtime.start()
        repository.startPresenceClock()
        pinger?.cancel()
        // «Я тут» каждые 20 секунд (сервер держит «в сети» 45 секунд — если телефон внезапно выключится).
        pinger = repository.scope.launch {
            while (isActive) {
                repository.presence(true)
                delay(20_000)
            }
        }
        registerPush()
    }

    fun registerPush() {
        // Без google-services.json Firebase не настроен — тогда просто без push-уведомлений.
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                repository.scope.launch { runCatching { repository.registerPush(token) } }
            }
        }
    }

    companion object {
        /** Для мелких элементов экрана (аватары), которым неудобно передавать хранилище. */
        var repo: Repository? = null
            private set
    }
}
