package ru.beemes.app.ui.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.beemes.app.BuildConfig
import ru.beemes.app.data.Crypto
import ru.beemes.app.data.Emoji
import ru.beemes.app.data.Photos
import ru.beemes.app.data.Repository
import ru.beemes.app.data.User
import ru.beemes.app.data.PresenceClock
import ru.beemes.app.data.lastSeenText
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.components.HexShape
import ru.beemes.app.ui.components.Honeycomb
import ru.beemes.app.ui.openUrl
import ru.beemes.app.ui.theme.Accent
import ru.beemes.app.ui.theme.Danger
import ru.beemes.app.ui.theme.Online

/** Шапка профиля: цвет профиля, соты, большой аватар, имя с живым эмодзи-статусом. */
@Composable
private fun ProfileHeader(user: User, onBack: () -> Unit, subtitle: String, action: (@Composable () -> Unit)? = null) {
    val accent = Accent.forUser(user.accent, user.id)
    Box(Modifier.fillMaxWidth().clipToBounds().background(accent.brush)) {
        if (user.bgEmoji.isBlank()) Honeycomb(Modifier.matchParentSizeCompat(), accent.onColor.copy(alpha = 0.10f))
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(bottom = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад", tint = accent.onColor) }
                Spacer(Modifier.weight(1f))
                action?.invoke()
            }
            Box(Modifier.size(124.dp), contentAlignment = Alignment.Center) {
                if (user.bgEmoji.isNotBlank()) EmojiPattern(Emoji.charOf(user.bgEmoji), accent.onColor)
                Box(Modifier.size(124.dp).clip(HexShape).background(Color.White.copy(alpha = 0.35f)).padding(4.dp)) { Avatar(user, 116.dp) }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(user.title, color = accent.onColor, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                Emoji.statusCode(user.statusEmoji)?.let { Spacer(Modifier.size(6.dp)); AnimatedEmoji(it, 34.dp) }
            }
            Text(subtitle, color = accent.onColor.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

private fun Modifier.matchParentSizeCompat() = this.then(Modifier.fillMaxSize())

/** Узор из эмодзи вокруг аватара (как на сайте и в Telegram): силуэты цвета текста, ближе к аватару — крупнее. */
private val PATTERN = listOf(
    floatArrayOf(-112f, -44f, 30f, 0.34f), floatArrayOf(112f, -44f, 30f, 0.34f), floatArrayOf(-122f, 40f, 27f, 0.32f), floatArrayOf(122f, 40f, 27f, 0.32f),
    floatArrayOf(-74f, -98f, 24f, 0.3f), floatArrayOf(74f, -98f, 24f, 0.3f), floatArrayOf(-80f, 98f, 22f, 0.28f), floatArrayOf(80f, 98f, 22f, 0.28f),
    floatArrayOf(0f, -132f, 20f, 0.24f), floatArrayOf(-190f, -86f, 22f, 0.24f), floatArrayOf(190f, -86f, 22f, 0.24f), floatArrayOf(-198f, 4f, 24f, 0.24f),
    floatArrayOf(198f, 4f, 24f, 0.24f), floatArrayOf(-186f, 92f, 20f, 0.22f), floatArrayOf(186f, 92f, 20f, 0.22f), floatArrayOf(-140f, -140f, 18f, 0.2f),
    floatArrayOf(140f, -140f, 18f, 0.2f), floatArrayOf(-268f, -44f, 18f, 0.16f), floatArrayOf(268f, -44f, 18f, 0.16f),
)

@Composable
private fun EmojiPattern(emoji: String, tint: Color) {
    PATTERN.forEach { (x, y, size, alpha) ->
        Text(
            emoji, fontSize = (size * 0.8f).sp,
            modifier = Modifier.wrapContentSize(unbounded = true).offset(x.dp, y.dp)
                .graphicsLayer(alpha = alpha, compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen)
                .drawWithContent { drawContent(); drawRect(tint, blendMode = androidx.compose.ui.graphics.BlendMode.SrcIn) },
        )
    }
}

/** Цвета для своего градиента. */
private val GRADIENT_COLORS = listOf(
    0xFFFF4FD8, 0xFFFF5E8A, 0xFFFF3D3D, 0xFFFF8A00, 0xFFFFC23D, 0xFFFFF27A, 0xFFB7EB4A, 0xFF2BB673, 0xFF36D1C4, 0xFF4FC3F7,
    0xFF3D8BFF, 0xFF3B2BFF, 0xFF7D5CFF, 0xFFB84BFF, 0xFF8E2D6B, 0xFF6D4C41, 0xFF433E57, 0xFF15121F, 0xFFFFFFFF, 0xFFFFD6E8,
).map { Color(it) }

@Composable
private fun ColorRow(title: String, selected: Color, onPick: (Color) -> Unit) {
    Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(GRADIENT_COLORS.size) { i ->
            val c = GRADIENT_COLORS[i]
            val on = c.toArgb() == selected.toArgb()
            Box(
                Modifier.size(36.dp).clip(androidx.compose.foundation.shape.CircleShape).background(c)
                    .border(BorderStroke(if (on) 3.dp else 1.dp, if (on) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.outlineVariant), androidx.compose.foundation.shape.CircleShape)
                    .clickable { onPick(c) }
                    .semantics { contentDescription = "$title: цвет ${i + 1}"; this.selected = on },
            )
        }
    }
}

@Composable
internal fun Section(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        title?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 8.dp, bottom = 6.dp, top = 8.dp)) }
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) { Column(content = content) }
    }
}

@Composable
internal fun RowItem(icon: ImageVector, title: String, subtitle: String? = null, tint: Color = Color.Unspecified, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.primary else tint)
        Column(Modifier.weight(1f).padding(start = 16.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        trailing?.invoke() ?: if (onClick != null) Icon(Icons.Filled.ChevronRight, null, tint = MaterialTheme.colorScheme.outline) else Unit
    }
}

// ======================= Чужой профиль =======================

@Composable
fun PeerProfileScreen(
    repo: Repository, userId: String, onBack: () -> Unit, onOpenChat: (String) -> Unit, onCall: (chatId: String, video: Boolean) -> Unit, onSafety: (String) -> Unit,
) {
    val users by repo.users.collectAsState()
    val user = users[userId] ?: User(id = userId)
    val scope = rememberCoroutineScope()
    var blocked by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(userId) {
        runCatching { repo.user(userId, fresh = true) }
        blocked = runCatching { repo.blocked().any { it.blocked == userId } }.getOrDefault(false)
    }
    fun withChat(block: (String) -> Unit) {
        busy = true
        scope.launch {
            runCatching { repo.chatWith(userId) }.onSuccess { block(it.id) }.onFailure { error = it.message }
            busy = false
        }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).verticalScroll(rememberScrollState())) {
        val now by PresenceClock.now.collectAsState()
        ProfileHeader(user, onBack, "@${user.username} · ${lastSeenText(user, now)}")
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            QuickAction(Icons.AutoMirrored.Filled.Chat, "Написать", Modifier.weight(1f)) { withChat(onOpenChat) }
            QuickAction(Icons.Filled.Call, "Звонок", Modifier.weight(1f)) { withChat { onCall(it, false) } }
            QuickAction(Icons.Filled.Videocam, "Видео", Modifier.weight(1f)) { withChat { onCall(it, true) } }
        }
        if (busy) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 24.dp)) }
        if (user.bio.isNotBlank()) {
            Section("О себе") { ru.beemes.app.ui.components.EmojiText(user.bio, Modifier.padding(16.dp)) }
        }
        Section("Безопасность") {
            RowItem(Icons.Filled.Shield, "Код безопасности", "Сравните с собеседником, чтобы убедиться в шифровании") { withChat(onSafety) }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            RowItem(Icons.Filled.Block, if (blocked) "Разблокировать" else "Заблокировать", if (blocked) "Сейчас не может вам писать и звонить" else null, Danger) {
                scope.launch {
                    runCatching { if (blocked) repo.unblock(userId) else repo.block(userId) }.onSuccess { blocked = !blocked }.onFailure { error = it.message }
                }
            }
        }
        Spacer(Modifier.navigationBarsPadding().height(24.dp))
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = modifier) {
        Column(Modifier.padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

// ======================= Код безопасности =======================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SafetyCodeScreen(repo: Repository, chatId: String, onBack: () -> Unit) {
    val me by repo.me.collectAsState()
    val users by repo.users.collectAsState()
    var peerId by remember { mutableStateOf("") }
    LaunchedEffect(chatId) { peerId = repo.peerOf(repo.chat(chatId)) }
    val peer = users[peerId]
    val code = remember(me?.publicKey, peer?.publicKey) {
        val a = me?.publicKey.orEmpty(); val b = peer?.publicKey.orEmpty()
        if (a.isBlank() || b.isBlank()) emptyList() else Crypto.safetyCode(Crypto.unb64(a), Crypto.unb64(b))
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text("Код безопасности") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } }) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AnimatedEmoji(Emoji.codeOf("🔒") ?: "1f41d", 88.dp)
            Spacer(Modifier.height(16.dp))
            Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    code.chunked(2).forEach { pair ->
                        Text(pair.joinToString("   "), fontFamily = FontFamily.Monospace, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            Text(
                (peer?.title?.let { "У собеседника ($it) в профиле с вами должны быть те же цифры. " } ?: "У собеседника должны быть те же цифры. ") +
                    "Сравните их при встрече или по видеозвонку. " +
                    "Если они совпадают — сообщения точно шифруются для вас двоих и никто не подменил ключи.",
                style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ======================= Свой профиль =======================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MyProfileScreen(repo: Repository, onBack: () -> Unit) {
    val context = LocalContext.current
    val me by repo.me.collectAsState()
    val user = me ?: return
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf(user.name) }
    var bio by rememberSaveable { mutableStateOf(user.bio) }
    var accent by rememberSaveable { mutableStateOf(Accent.forUser(user.accent, user.id).key) }
    var status by rememberSaveable { mutableStateOf(user.statusEmoji) }
    var bgEmoji by rememberSaveable { mutableStateOf(user.bgEmoji) }
    var pickPattern by remember { mutableStateOf(false) }
    var hideSeen by rememberSaveable { mutableStateOf(user.hideLastSeen) }
    var pickStatus by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching { repo.setAvatar(withContext(Dispatchers.IO) { Photos.avatar(context, uri) }) }.onFailure { message = it.message }
            busy = false
        }
    }
    val preview = user.copy(name = name, accent = accent, statusEmoji = status, bgEmoji = bgEmoji)
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).verticalScroll(rememberScrollState())) {
        ProfileHeader(preview, onBack, "@${user.username}") {
            IconButton(onClick = { pickAvatar.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                Icon(Icons.Filled.PhotoCamera, "Сменить фото", tint = Accent.of(accent).onColor)
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(name, { name = it.take(64) }, label = { Text("Имя") }, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                bio, { bio = it.take(200) }, label = { Text("О себе") }, maxLines = 4, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                supportingText = { Text("${bio.length}/200") },
            )
            Text("Цвет профиля", style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Accent.entries.forEach { a ->
                    Box(
                        Modifier.size(46.dp).clip(HexShape).background(a.brush).clickable { accent = a.key }
                            .then(if (accent == a.key) Modifier.border(BorderStroke(3.dp, MaterialTheme.colorScheme.onBackground), HexShape) else Modifier)
                            .semantics { contentDescription = a.title },
                        contentAlignment = Alignment.Center,
                    ) { if (accent == a.key) Text("✓", color = a.onColor, fontWeight = FontWeight.Bold, fontSize = 18.sp) }
                }
                // Свой градиент
                val custom = Accent.custom(accent)
                Box(
                    Modifier.size(46.dp).clip(HexShape)
                        .background(custom?.brush ?: Brush.sweepGradient(listOf(Color(0xFFFF5E8A), Color(0xFFFFB25B), Color(0xFFFFF27A), Color(0xFF45E0B0), Color(0xFF4FC3F7), Color(0xFF7D5CFF), Color(0xFFFF5E8A))))
                        .clickable { if (custom == null) { val cur = Accent.of(accent); accent = Accent.customKey(cur.start, cur.end) } }
                        .then(if (custom != null) Modifier.border(BorderStroke(3.dp, MaterialTheme.colorScheme.onBackground), HexShape) else Modifier)
                        .semantics { contentDescription = "Свой градиент" },
                    contentAlignment = Alignment.Center,
                ) { Text(if (custom != null) "✓" else "+", color = custom?.onColor ?: Color.White, fontWeight = FontWeight.Black, fontSize = 20.sp) }
            }
            Accent.custom(accent)?.let { c ->
                Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ColorRow("Начало", c.start) { accent = Accent.customKey(it, c.end) }
                        ColorRow("Конец", c.end) { accent = Accent.customKey(c.start, it) }
                    }
                }
            }
            Text("Им красятся ваши сообщения и шапка профиля.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(onClick = { pickStatus = true }, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Emoji.statusCode(status)?.let { AnimatedEmoji(it, 36.dp) } ?: Text("😶", fontSize = 28.sp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("Эмодзи-статус", style = MaterialTheme.typography.bodyLarge)
                        Text("Живой эмодзи рядом с вашим именем", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (status.isNotBlank()) TextButton(onClick = { status = "" }) { Text("Убрать") }
                }
            }
            Surface(onClick = { pickPattern = true }, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Accent.of(accent).brush), contentAlignment = Alignment.Center) {
                        Text(if (bgEmoji.isNotBlank()) Emoji.charOf(bgEmoji) else "✨", fontSize = 22.sp)
                    }
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("Узор на фоне профиля", style = MaterialTheme.typography.bodyLarge)
                        Text("Эмодзи вокруг аватара в шапке профиля", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (bgEmoji.isNotBlank()) TextButton(onClick = { bgEmoji = "" }) { Text("Убрать") }
                }
            }
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(Modifier.fillMaxWidth().clickable { hideSeen = !hideSeen }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.VisibilityOff, null, tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("Скрывать, когда я был(а) в сети", style = MaterialTheme.typography.bodyLarge)
                        Text("Собеседники увидят «был(а) недавно»", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(hideSeen, { hideSeen = it })
                }
            }
            if (user.avatar.isNotBlank()) TextButton(onClick = { scope.launch { runCatching { repo.setAvatar(null) } } }) { Text("Убрать фото профиля") }
            message?.let { Text(it, color = if (it.startsWith("✓")) Online else MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        message = runCatching { repo.updateProfile(name, bio, accent, status, hideSeen, bgEmoji) }.fold({ "✓ Сохранено" }, { it.message })
                        busy = false
                    }
                },
                enabled = !busy && name.isNotBlank(), modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp),
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Сохранить", fontWeight = FontWeight.Bold) }
            Spacer(Modifier.navigationBarsPadding().height(16.dp))
        }
    }
    if (pickStatus || pickPattern) {
        val close = { pickStatus = false; pickPattern = false }
        AlertDialog(
            onDismissRequest = close,
            title = { Text(if (pickPattern) "Узор на фоне профиля" else "Эмодзи-статус") },
            text = {
                LazyVerticalGrid(GridCells.Adaptive(52.dp), Modifier.height(360.dp), contentPadding = PaddingValues(4.dp)) {
                    items(Emoji.groups.flatMap { it.items }, key = { it.c }) { item ->
                        Box(
                            Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)).clickable { if (pickPattern) bgEmoji = item.c else status = item.c; close() }
                                .semantics { contentDescription = item.e },
                            contentAlignment = Alignment.Center,
                        ) { AnimatedEmoji(item.c, 40.dp) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = close) { Text("Закрыть") } },
        )
    }
}

// ======================= Настройки =======================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    repo: Repository, theme: String, onTheme: (String) -> Unit, onBack: () -> Unit,
    onProfile: () -> Unit, onPassword: () -> Unit, onBlocked: () -> Unit, onAbout: () -> Unit, onSchool: () -> Unit = {},
    onDevices: () -> Unit = {}, onSecurity: () -> Unit = {},
) {
    val me by repo.me.collectAsState()
    val student by repo.school.student.collectAsState()
    val context = LocalContext.current
    var notifications by remember { mutableStateOf(repo.notificationsEnabled) }
    var confirmLogout by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Настройки") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            me?.let { user ->
                Surface(onClick = onProfile, shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.padding(16.dp)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(user, 64.dp)
                        Column(Modifier.weight(1f).padding(start = 14.dp)) {
                            ru.beemes.app.ui.components.NameWithStatus(user, MaterialTheme.typography.titleLarge, emojiSize = 24.dp)
                            Text("@${user.username}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Filled.Edit, "Изменить", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            Section("Оформление") {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.DarkMode, null, tint = MaterialTheme.colorScheme.primary)
                    SingleChoiceSegmentedButtonRow(Modifier.padding(start = 16.dp).fillMaxWidth()) {
                        listOf("system" to "Авто", "light" to "Светлая", "dark" to "Тёмная").forEachIndexed { i, (key, label) ->
                            SegmentedButton(selected = theme == key, onClick = { onTheme(key) }, shape = SegmentedButtonDefaults.itemShape(i, 3), icon = {}) { Text(label, fontSize = 13.sp, maxLines = 1) }
                        }
                    }
                }
            }
            Section("Учёба") {
                RowItem(
                    Icons.Filled.School, "Простая химия",
                    student?.let { "${it.name.ifBlank { it.username }} · оценки за работы" } ?: "Подключить учебный профиль и видеть оценки",
                    onClick = onSchool,
                )
            }
            Section("Уведомления") {
                RowItem(Icons.Filled.Notifications, "Уведомления о сообщениях", "Звонки приходят всегда", trailing = {
                    Switch(notifications, { notifications = it; repo.notificationsEnabled = it })
                })
            }
            Section("Безопасность") {
                RowItem(Icons.Filled.Devices, "Устройства", "Где вы вошли · вход по QR-коду", onClick = onDevices)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
                RowItem(
                    Icons.Filled.MarkEmailRead, "Почта и 2FA",
                    when { me?.twoFactor == true -> "Код из письма при входе включён"; me?.verified == true -> "Почта привязана"; else -> "Код из письма при входе" },
                    onClick = onSecurity,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
                RowItem(Icons.Filled.Key, "Сменить пароль", "Ключ шифрования перешифруется новым паролем", onClick = onPassword)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
                RowItem(Icons.Filled.Block, "Заблокированные", onClick = onBlocked)
            }
            Section {
                RowItem(Icons.Filled.Info, "О beemes", "Версия ${BuildConfig.VERSION_NAME}", onClick = onAbout)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
                RowItem(Icons.Filled.Shield, "Политика конфиденциальности", onClick = { context.openUrl(repo.siteUrl + "/privacy.html") })
            }
            Section {
                RowItem(Icons.AutoMirrored.Filled.ExitToApp, "Выйти", tint = Danger, onClick = { confirmLogout = true })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
                RowItem(Icons.Filled.DeleteForever, "Удалить аккаунт", "Профиль, ключи и все чаты — навсегда", tint = Danger, onClick = { confirmDelete = true })
            }
            Spacer(Modifier.navigationBarsPadding().height(16.dp))
        }
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Выйти из аккаунта?") },
            text = { Text("Переписка останется на сервере зашифрованной. Чтобы снова её читать, войдите с тем же паролем.") },
            confirmButton = { TextButton(onClick = { confirmLogout = false; repo.logout() }) { Text("Выйти", color = Danger) } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Отмена") } },
        )
    }
    if (confirmDelete) DeleteAccountDialog(repo, me?.username.orEmpty()) { confirmDelete = false }
}

/** Удаление аккаунта: нужно ввести своё @имя, чтобы не удалить случайно. */
@Composable
private fun DeleteAccountDialog(repo: Repository, username: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var typed by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val matches = typed.trim().removePrefix("@").equals(username, ignoreCase = true) && username.isNotEmpty()
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Удалить аккаунт?") },
        text = {
            Column {
                Text("Удалятся профиль, ключи шифрования и все ваши чаты с сообщениями — у собеседников тоже. Вернуть их будет нельзя.")
                Text("Чтобы подтвердить, введите своё имя: @$username", modifier = Modifier.padding(top = 12.dp), fontWeight = FontWeight.SemiBold)
                OutlinedTextField(
                    typed, { typed = it; error = null }, singleLine = true, placeholder = { Text("@$username") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp), enabled = !busy,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 6.dp)) }
            }
        },
        confirmButton = {
            TextButton(enabled = matches && !busy, onClick = {
                busy = true
                scope.launch {
                    runCatching { repo.deleteAccount() }
                        .onSuccess { onDismiss() }
                        .onFailure { error = it.message ?: "Не получилось удалить аккаунт"; busy = false }
                }
            }) { Text(if (busy) "Удаляем…" else "Удалить навсегда", color = if (matches) Danger else Color.Unspecified) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Отмена") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PasswordScreen(repo: Repository, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var new2 by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    Scaffold(
        topBar = { TopAppBar(title = { Text("Смена пароля") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } }) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val pw = androidx.compose.ui.text.input.PasswordVisualTransformation()
            OutlinedTextField(old, { old = it }, label = { Text("Текущий пароль") }, visualTransformation = pw, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(new, { new = it }, label = { Text("Новый пароль") }, visualTransformation = pw, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(), supportingText = { Text("Не меньше 8 символов") })
            OutlinedTextField(new2, { new2 = it }, label = { Text("Повторите новый пароль") }, visualTransformation = pw, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            message?.let { Text(it, color = if (it.startsWith("✓")) Online else MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    if (new.length < 8) { message = "Новый пароль: не меньше 8 символов"; return@Button }
                    if (new != new2) { message = "Пароли не совпадают"; return@Button }
                    busy = true
                    scope.launch {
                        message = runCatching { repo.changePassword(old, new) }.fold({ "✓ Пароль изменён. На других устройствах нужно войти заново." }, { it.message })
                        busy = false
                    }
                },
                enabled = !busy, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp),
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Сменить пароль") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockedScreen(repo: Repository, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<User>?>(null) }
    LaunchedEffect(Unit) { list = runCatching { repo.blocked().map { repo.user(it.blocked) } }.getOrDefault(emptyList()) }
    Scaffold(
        topBar = { TopAppBar(title = { Text("Заблокированные") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } }) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                list == null -> CircularProgressIndicator(Modifier.padding(24.dp))
                list!!.isEmpty() -> Text("Вы никого не блокировали", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> list!!.forEach { u ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(u, 46.dp)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(u.title, style = MaterialTheme.typography.titleMedium)
                            Text("@${u.username}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        OutlinedButton(onClick = { scope.launch { runCatching { repo.unblock(u.id) }; list = list!!.filterNot { it.id == u.id } } }) { Text("Разблокировать") }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(repo: Repository, onBack: () -> Unit) {
    val context = LocalContext.current
    val release by androidx.compose.runtime.produceState<ru.beemes.app.data.AppRelease?>(null) { value = repo.latestRelease() }
    Scaffold(
        topBar = { TopAppBar(title = { Text("О beemes") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } }) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(24.dp).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            AnimatedEmoji("1f41d", 120.dp)
            Text("beemes", fontSize = 34.sp, fontWeight = FontWeight.Black)
            Text("Версия ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            release?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }?.let { r ->
                Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.padding(top = 16.dp).fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Вышла версия ${r.versionName}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        if (r.notes.isNotBlank()) Text(r.notes, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.padding(top = 4.dp))
                        Button(onClick = { context.openUrl(repo.siteUrl + "/#download") }, modifier = Modifier.padding(top = 10.dp)) { Text("Скачать") }
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            Text(
                "Сообщения, фото и звонки зашифрованы на телефонах (X25519, AES-256-GCM, WebRTC DTLS-SRTP). " +
                    "Сервер хранит только зашифрованные данные и не может их прочитать.",
                textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(20.dp))
            Text("Благодарности", style = MaterialTheme.typography.titleMedium)
            Text(
                "Анимированные эмодзи — Noto Emoji Animation, © Google, лицензия CC BY 4.0.\n" +
                    "Анимация — Lottie (Airbnb), шифрование — Tink (Google), Apache 2.0.",
                textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
            TextButton(onClick = { context.openUrl("https://creativecommons.org/licenses/by/4.0/") }) { Text("Лицензия CC BY 4.0") }
            TextButton(onClick = { context.openUrl(repo.siteUrl) }) { Text("Сайт beemes") }
        }
    }
}
