package ru.beemes.app.ui

import android.content.Intent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import ru.beemes.app.BeemesApp
import ru.beemes.app.call.CallActivity
import ru.beemes.app.call.IncomingCallActivity
import ru.beemes.app.ui.auth.LoginScreen
import ru.beemes.app.ui.auth.RegisterScreen
import ru.beemes.app.ui.auth.WelcomeScreen
import ru.beemes.app.ui.chat.ChatScreen
import ru.beemes.app.ui.chats.ChatListScreen
import ru.beemes.app.ui.chats.SearchScreen
import ru.beemes.app.ui.profile.AboutScreen
import ru.beemes.app.ui.profile.BlockedScreen
import ru.beemes.app.ui.profile.MyProfileScreen
import ru.beemes.app.ui.profile.PasswordScreen
import ru.beemes.app.ui.profile.PeerProfileScreen
import ru.beemes.app.ui.profile.SafetyCodeScreen
import ru.beemes.app.ui.profile.SettingsScreen
import ru.beemes.app.ui.school.SchoolScreen

private const val SLIDE = 260

private fun NavHostController.back() {
    if (previousBackStackEntry != null) popBackStack()
}

/** Все экраны приложения: вход/регистрация или чаты, профиль и настройки. */
@Composable
fun AppNavigation(
    app: BeemesApp,
    openChat: MutableStateFlow<String?>,
    onTheme: (String) -> Unit,
    onSignedIn: () -> Unit,
) {
    val repo = app.repository
    val me by repo.me.collectAsState()
    if (me == null) AuthFlow(app, onSignedIn) else MainFlow(app, openChat, onTheme)
}

@Composable
private fun AuthFlow(app: BeemesApp, onSignedIn: () -> Unit) {
    val nav = rememberNavController()
    val repo = app.repository
    NavHost(
        nav, startDestination = if (repo.signedOutRemotely.value) "login" else "welcome",
        enterTransition = { slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(SLIDE)) + fadeIn(tween(SLIDE)) },
        exitTransition = { fadeOut(tween(SLIDE)) },
        popEnterTransition = { fadeIn(tween(SLIDE)) },
        popExitTransition = { slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(SLIDE)) + fadeOut(tween(SLIDE)) },
    ) {
        composable("welcome") { WelcomeScreen(onRegister = { nav.navigate("register") }, onLogin = { nav.navigate("login") }) }
        composable("register") { RegisterScreen(repo, onBack = { nav.back() }, onDone = onSignedIn) }
        composable("login") { LoginScreen(repo, onBack = { nav.back() }, onDone = onSignedIn, onQr = { nav.navigate("qr-login") }) }
        composable("qr-login") { ru.beemes.app.ui.auth.QrLoginScreen(repo, onBack = { nav.back() }, onDone = onSignedIn) }
    }
}

@Composable
private fun MainFlow(app: BeemesApp, openChat: MutableStateFlow<String?>, onTheme: (String) -> Unit) {
    val nav = rememberNavController()
    val repo = app.repository
    val context = LocalContext.current
    var theme by remember { mutableStateOf(repo.theme) }

    fun call(chatId: String, video: Boolean) = CallActivity.open(context, repo.callUrl(chatId, video), chatId)

    // Нажали на уведомление о сообщении — открываем этот чат.
    val pendingChat by openChat.collectAsState()
    LaunchedEffect(pendingChat) {
        val id = pendingChat ?: return@LaunchedEffect
        openChat.value = null
        // Ссылка-приглашение (открыли из браузера/мессенджера), QR-код входа нового устройства или чат из уведомления.
        if (id.startsWith("link:") && "#/qr/" in id) nav.navigate("qr/" + android.net.Uri.encode(id.removePrefix("link:"))) { launchSingleTop = true }
        else if (id.startsWith("link:")) nav.navigate("join/" + android.net.Uri.encode(id.removePrefix("link:"))) { launchSingleTop = true }
        else nav.navigate("chat/$id") {
            popUpTo("chats")
            launchSingleTop = true
        }
    }

    // Пока приложение открыто, звонки приходят и по realtime (даже без Firebase).
    LaunchedEffect(Unit) {
        repo.realtime.signals.collect { s ->
            val myId = repo.me.value?.id ?: return@collect
            when (s.type) {
                "ring" -> if (s.to == myId && s.from != myId && !IncomingCallActivity.isShowing(s.call)) {
                    context.startActivity(
                        Intent(context, IncomingCallActivity::class.java)
                            .putExtras(IncomingCallActivity.extras(s.call, s.chat, s.from, s.name, s.video))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
                "accept", "decline", "hangup" -> IncomingCallActivity.finishCall(s.call)
            }
        }
    }

    NavHost(
        nav, startDestination = "chats",
        enterTransition = { slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(SLIDE)) },
        exitTransition = { fadeOut(tween(SLIDE)) },
        popEnterTransition = { fadeIn(tween(SLIDE)) },
        popExitTransition = { slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(SLIDE)) },
    ) {
        composable("chats") {
            ChatListScreen(
                repo,
                onOpenChat = { nav.navigate("chat/$it") { launchSingleTop = true } },
                onSearch = { nav.navigate("search") },
                onSettings = { nav.navigate("settings") },
                onNewGroup = { nav.navigate("new/$it") },
            )
        }
        composable("search") {
            SearchScreen(
                repo, onBack = { nav.back() }, onOpenProfile = { nav.navigate("profile/$it") },
                onOpenChat = { nav.navigate("chat/$it") { launchSingleTop = true } },
                onInvite = { nav.navigate("join/" + android.net.Uri.encode(it)) },
            )
        }
        composable("new/{type}") { entry ->
            ru.beemes.app.ui.groups.NewGroupScreen(repo, entry.arguments?.getString("type").orEmpty(), onBack = { nav.back() },
                onCreated = { id -> nav.navigate("chat/$id") { popUpTo("chats"); launchSingleTop = true } })
        }
        composable("group/{id}") { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            ru.beemes.app.ui.groups.GroupInfoScreen(
                repo, id, onBack = { nav.back() },
                onOpenChat = { chatId -> if (!nav.popBackStack("chat/{id}", inclusive = false)) nav.navigate("chat/$chatId") { popUpTo("chats"); launchSingleTop = true } },
                onOpenProfile = { nav.navigate("profile/$it") },
                onLeft = { nav.popBackStack("chats", inclusive = false) },
            )
        }
        composable("join/{link}") { entry ->
            ru.beemes.app.ui.groups.JoinScreen(repo, android.net.Uri.decode(entry.arguments?.getString("link").orEmpty()), onBack = { nav.back() },
                onJoined = { id -> nav.navigate("chat/$id") { popUpTo("chats"); launchSingleTop = true } })
        }
        composable("chat/{id}") { entry ->
            val chatId = entry.arguments?.getString("id").orEmpty()
            ChatScreen(
                repo, chatId,
                onBack = { nav.back() },
                onOpenProfile = { nav.navigate("profile/$it") { launchSingleTop = true } },
                onCall = { video -> call(chatId, video) },
                onOpenGroup = { nav.navigate("group/$it") { launchSingleTop = true } },
            )
        }
        composable("profile/{id}") { entry ->
            val userId = entry.arguments?.getString("id").orEmpty()
            PeerProfileScreen(
                repo, userId,
                onBack = { nav.back() },
                onOpenChat = { chatId ->
                    // Если пришли из этого же чата — просто возвращаемся в него.
                    if (!nav.popBackStack("chat/{id}", inclusive = false) || nav.currentBackStackEntry?.arguments?.getString("id") != chatId) {
                        nav.navigate("chat/$chatId") { popUpTo("chats"); launchSingleTop = true }
                    }
                },
                onCall = { chatId, video -> call(chatId, video) },
                onSafety = { nav.navigate("safety/$it") },
            )
        }
        composable("safety/{chat}") { entry ->
            SafetyCodeScreen(repo, entry.arguments?.getString("chat").orEmpty(), onBack = { nav.back() })
        }
        composable("settings") {
            SettingsScreen(
                repo, theme,
                onTheme = { theme = it; onTheme(it) },
                onBack = { nav.back() },
                onProfile = { nav.navigate("me") },
                onPassword = { nav.navigate("password") },
                onBlocked = { nav.navigate("blocked") },
                onAbout = { nav.navigate("about") },
                onSchool = { nav.navigate("school") },
                onDevices = { nav.navigate("devices") },
                onSecurity = { nav.navigate("security") },
            )
        }
        composable("devices") {
            ru.beemes.app.ui.profile.DevicesScreen(repo, onBack = { nav.back() }, onQr = { nav.navigate("qr/" + android.net.Uri.encode(it)) })
        }
        composable("security") { ru.beemes.app.ui.profile.SecurityScreen(repo, onBack = { nav.back() }) }
        composable("qr/{link}") { entry ->
            ru.beemes.app.ui.profile.QrApproveScreen(repo, android.net.Uri.decode(entry.arguments?.getString("link").orEmpty()), onBack = { nav.back() })
        }
        composable("me") { MyProfileScreen(repo, onBack = { nav.back() }) }
        composable("password") { PasswordScreen(repo, onBack = { nav.back() }) }
        composable("blocked") { BlockedScreen(repo, onBack = { nav.back() }) }
        composable("about") { AboutScreen(repo, onBack = { nav.back() }) }
        composable("school") { SchoolScreen(repo, onBack = { nav.back() }) }
    }
}
