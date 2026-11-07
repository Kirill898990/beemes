package ru.beemes.app.ui.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SentimentSatisfied
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.beemes.app.data.Crypto
import ru.beemes.app.data.Emoji
import ru.beemes.app.data.Msg
import ru.beemes.app.data.Photos
import ru.beemes.app.data.Repository
import ru.beemes.app.data.SendStatus
import ru.beemes.app.data.User
import ru.beemes.app.data.dayTitle
import ru.beemes.app.data.PresenceClock
import ru.beemes.app.data.lastSeenText
import ru.beemes.app.data.timeOfDay
import ru.beemes.app.push.Notifier
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.components.EmojiText
import ru.beemes.app.ui.components.Honeycomb
import ru.beemes.app.ui.components.NameWithStatus
import ru.beemes.app.ui.theme.Accent
import ru.beemes.app.ui.theme.Danger
import ru.beemes.app.ui.theme.Honey
import ru.beemes.app.ui.theme.Online
import java.time.ZoneId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    repo: Repository,
    chatId: String,
    onBack: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onCall: (video: Boolean) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages by repo.messages(chatId).collectAsState()
    val users by repo.users.collectAsState()
    val me by repo.me.collectAsState()
    var peerId by remember { mutableStateOf(repo.chatItem(chatId)?.peer?.id.orEmpty()) }
    val peer = users[peerId] ?: repo.chatItem(chatId)?.peer
    var text by rememberSaveable { mutableStateOf("") }
    var emojiOpen by rememberSaveable { mutableStateOf(false) }
    var replyTo by remember { mutableStateOf<Msg?>(null) }
    var editing by remember { mutableStateOf<Msg?>(null) }
    var menuFor by remember { mutableStateOf<Msg?>(null) }
    var viewer by remember { mutableStateOf<Msg?>(null) }
    var photoToSend by remember { mutableStateOf<Photos.Prepared?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current

    DisposableEffect(chatId) {
        repo.openChatId = chatId
        Notifier.clearChat(context, chatId)
        onDispose { if (repo.openChatId == chatId) repo.openChatId = null }
    }
    LaunchedEffect(chatId) {
        runCatching {
            val c = repo.chat(chatId)
            peerId = repo.peerOf(c)
            repo.user(peerId, fresh = true)
            hasMore = repo.loadMessages(chatId)
        }.onFailure { error = it.message }
    }
    // Новые сообщения видно — значит прочитаны.
    LaunchedEffect(messages.lastOrNull()?.id) {
        if (messages.isNotEmpty()) { delay(400); runCatching { repo.markRead(chatId) } }
        if (listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }
    // Долистали до начала — подгружаем более ранние.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.distinctUntilChanged().collect { last ->
            val total = listState.layoutInfo.totalItemsCount
            if (hasMore && !loadingMore && total > 0 && last >= total - 5) {
                val oldest = repo.messages(chatId).value.firstOrNull { it.status != SendStatus.SENDING } ?: return@collect
                loadingMore = true
                hasMore = runCatching { repo.loadMessages(chatId, oldest.created) }.getOrDefault(false)
                loadingMore = false
            }
        }
    }
    BackHandler(emojiOpen) { emojiOpen = false }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            photoToSend = runCatching { withContext(Dispatchers.IO) { repo.preparePhoto(uri) } }.getOrElse { error = it.message; null }
        }
    }

    fun send() {
        val t = text.trim()
        if (t.isEmpty()) return
        val edit = editing
        val reply = replyTo
        text = ""; replyTo = null; editing = null
        scope.launch {
            if (edit != null) runCatching { repo.edit(edit, t) }.onFailure { error = it.message }
            else repo.sendText(chatId, t, reply?.id.orEmpty())
        }
    }

    val myAccent = Accent.forUser(me?.accent.orEmpty(), me?.id.orEmpty())
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).imePadding()) {
        ChatTopBar(peer, onBack, { peer?.let { onOpenProfile(it.id) } }, onCall)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Honeycomb(Modifier.fillMaxSize())
            val items = remember(messages) { buildItems(messages) }
            if (messages.isEmpty() && !hasMore) {
                EmptyChat(peer) { e -> scope.launch { repo.sendText(chatId, e) } }
            }
            LazyColumn(
                state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                itemsIndexed(items, key = { _, it -> it.key }) { _, item ->
                    when (item) {
                        is Item.Day -> DayChip(item.title)
                        is Item.Message -> {
                            val m = item.msg
                            val mine = m.senderId == me?.id
                            MessageRow(
                                repo, m, mine, myAccent, peer,
                                reply = m.replyTo.takeIf { it.isNotBlank() }?.let { r -> messages.firstOrNull { it.id == r } },
                                onLongPress = { menuFor = m },
                                onPhoto = { viewer = m },
                                onRetry = { scope.launch { repo.retry(m) } },
                            )
                        }
                    }
                }
                if (loadingMore) item { Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { androidx.compose.material3.CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) } }
                item { EncryptionNote() }
            }
        }
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            LaunchedEffect(it) { delay(4000); error = null }
        }
        InputBar(
            text = text, onText = { text = it },
            replyTo = replyTo, editing = editing, peer = peer, myId = me?.id.orEmpty(),
            emojiOpen = emojiOpen,
            onToggleEmoji = {
                if (emojiOpen) { emojiOpen = false; keyboard?.show() } else { keyboard?.hide(); focus.clearFocus(); emojiOpen = true }
            },
            onCancel = { if (editing != null) text = ""; replyTo = null; editing = null },
            onAttach = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            onSend = ::send,
            onFocus = { emojiOpen = false },
        )
        AnimatedVisibility(emojiOpen) {
            EmojiPanel(onPick = { text += it }, onSendBig = { e -> scope.launch { repo.sendText(chatId, e) } })
        }
        if (!emojiOpen) Spacer(Modifier.navigationBarsPadding())
    }

    menuFor?.let { m ->
        val mine = m.senderId == me?.id
        ModalBottomSheet(onDismissRequest = { menuFor = null }) {
            Column(Modifier.padding(bottom = 24.dp)) {
                if (m.status == SendStatus.FAILED) {
                    MenuRow(Icons.Filled.Refresh, "Отправить ещё раз") { scope.launch { repo.retry(m) }; menuFor = null }
                    MenuRow(Icons.Filled.Delete, "Удалить", Danger) { repo.discard(m); menuFor = null }
                } else {
                    MenuRow(Icons.AutoMirrored.Filled.Reply, "Ответить") { replyTo = m; editing = null; menuFor = null }
                    if (m.text.isNotBlank()) MenuRow(Icons.Filled.ContentCopy, "Копировать") { clipboard.setText(AnnotatedString(m.text)); menuFor = null }
                    if (mine && m.kind == "text") MenuRow(Icons.Filled.Edit, "Изменить") { editing = m; replyTo = null; text = m.text; menuFor = null }
                    if (mine) MenuRow(Icons.Filled.Delete, "Удалить у всех", Danger) {
                        scope.launch { runCatching { repo.delete(m) }.onFailure { error = it.message } }; menuFor = null
                    }
                }
            }
        }
    }
    viewer?.let { m -> PhotoViewer(repo, m) { viewer = null } }
    photoToSend?.let { p ->
        SendPhotoDialog(p, onDismiss = { photoToSend = null }) { caption ->
            photoToSend = null
            scope.launch { repo.sendPhoto(chatId, p, caption) }
        }
    }
}

private sealed interface Item {
    val key: String
    data class Day(val title: String, override val key: String) : Item
    data class Message(val msg: Msg) : Item { override val key get() = msg.localId.ifBlank { msg.id } }
}

/** Сообщения новые сверху (список перевёрнут) с плашками дат. */
private fun buildItems(messages: List<Msg>): List<Item> {
    val out = mutableListOf<Item>()
    val zone = ZoneId.systemDefault()
    val reversed = messages.asReversed()
    reversed.forEachIndexed { i, m ->
        out += Item.Message(m)
        val day = m.created.atZone(zone).toLocalDate()
        val nextDay = reversed.getOrNull(i + 1)?.created?.atZone(zone)?.toLocalDate()
        if (nextDay != day) out += Item.Day(dayTitle(m.created), "day-$day")
    }
    return out
}

@Composable
private fun ChatTopBar(peer: User?, onBack: () -> Unit, onProfile: () -> Unit, onCall: (Boolean) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shadowElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().height(60.dp).padding(end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") }
            Row(Modifier.weight(1f).clickable(onClick = onProfile), verticalAlignment = Alignment.CenterVertically) {
                if (peer != null) Avatar(peer, 40.dp)
                Column(Modifier.padding(start = 10.dp)) {
                    if (peer != null) NameWithStatus(peer, MaterialTheme.typography.titleMedium, emojiSize = 18.dp)
                    val now by PresenceClock.now.collectAsState()
                    val status = peer?.let { lastSeenText(it, now) }.orEmpty()
                    Text(status, style = MaterialTheme.typography.bodyMedium, color = if (peer?.onlineAt(now) == true) Online else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            IconButton(onClick = { onCall(true) }) { Icon(Icons.Filled.Videocam, "Видеозвонок") }
            IconButton(onClick = { onCall(false) }) { Icon(Icons.Filled.Call, "Позвонить") }
        }
    }
}

@Composable
private fun DayChip(title: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Text(
            title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 5.dp),
        )
    }
}

@Composable
private fun EncryptionNote() {
    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier.background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.85f), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Lock, null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                "  Сообщения и фото зашифрованы на телефонах. Прочитать их можете только вы двое.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun EmptyChat(peer: User?, onSend: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Surface(color = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.95f), shape = RoundedCornerShape(24.dp)) {
            Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                AnimatedEmoji("1f44b", 96.dp, Modifier.clickable { onSend("👋") })
                Text("Поздоровайтесь с ${peer?.title ?: "собеседником"}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                Text("Нажмите на руку, чтобы помахать", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    repo: Repository, m: Msg, mine: Boolean, myAccent: Accent, peer: User?, reply: Msg?,
    onLongPress: () -> Unit, onPhoto: () -> Unit, onRetry: () -> Unit,
) {
    val big = if (m.kind == "text") Emoji.bigEmoji(m.text) else null
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        val shape = RoundedCornerShape(20.dp, 20.dp, if (mine) 6.dp else 20.dp, if (mine) 20.dp else 6.dp)
        val onBubble = if (mine) myAccent.onColor else MaterialTheme.colorScheme.onSurface
        val metaColor = if (mine) onBubble.copy(alpha = 0.75f) else MaterialTheme.colorScheme.onSurfaceVariant
        Column(
            Modifier.widthIn(max = 300.dp)
                .combinedClickable(onClick = { if (m.kind == "photo") onPhoto() else if (m.status == SendStatus.FAILED) onRetry() }, onLongClick = onLongPress)
                .then(
                    if (big != null) Modifier
                    else Modifier.clip(shape).background(if (mine) myAccent.brush else Brush.linearGradient(listOf(MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.colorScheme.surfaceContainerHigh)))
                        .padding(if (m.kind == "photo") 4.dp else 10.dp),
                ),
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        ) {
            if (reply != null) ReplyQuote(reply, mine, onBubble, peer)
            when {
                m.content == null -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Lock, null, Modifier.size(16.dp), tint = metaColor)
                    Text(" Не удалось расшифровать", color = metaColor, style = MaterialTheme.typography.bodyMedium)
                }
                big != null -> Row { big.forEach { AnimatedEmoji(it, if (big.size == 1) 120.dp else if (big.size == 2) 88.dp else 72.dp) } }
                m.kind == "photo" -> PhotoBubble(repo, m, onBubble)
                m.kind == "call" -> CallBubble(m, mine, onBubble)
                else -> EmojiText(m.text, color = onBubble, style = MaterialTheme.typography.bodyLarge)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 2.dp).then(
                    if (big != null) Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(10.dp)).padding(horizontal = 6.dp, vertical = 2.dp)
                    else if (m.kind == "photo") Modifier.padding(horizontal = 6.dp, vertical = 2.dp) else Modifier,
                ),
            ) {
                val color = if (big != null) MaterialTheme.colorScheme.onSurfaceVariant else metaColor
                if (m.edited) Text("изм. ", fontSize = 11.sp, color = color)
                Text(timeOfDay(m.created), fontSize = 11.sp, color = color)
                if (mine) {
                    val (icon, tint) = when (m.status) {
                        SendStatus.SENDING -> Icons.Filled.AccessTime to color
                        SendStatus.FAILED -> Icons.Filled.ErrorOutline to Danger
                        SendStatus.READ -> Icons.Filled.DoneAll to color
                        SendStatus.SENT -> Icons.Filled.Done to color
                    }
                    Icon(icon, null, Modifier.padding(start = 3.dp).size(15.dp), tint = tint)
                }
            }
        }
    }
}

@Composable
private fun ReplyQuote(reply: Msg, mine: Boolean, onBubble: Color, peer: User?) {
    val me = ru.beemes.app.BeemesApp.repo?.me?.collectAsState()?.value
    val who = if (reply.senderId == me?.id) "Вы" else peer?.title ?: ""
    Row(
        Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(10.dp)).background(onBubble.copy(alpha = 0.12f)).padding(end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).height(36.dp).background(if (mine) onBubble else Honey))
        Column(Modifier.padding(start = 8.dp, top = 3.dp, bottom = 3.dp)) {
            Text(who, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (mine) onBubble else Honey)
            EmojiText(reply.preview(), color = onBubble.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
    }
}

@Composable
private fun PhotoBubble(repo: Repository, m: Msg, onBubble: Color) {
    val c = m.content ?: return
    var bitmap by remember(m.id) { mutableStateOf<Bitmap?>(repo.cachedPhoto(m)) }
    val preview = remember(c.p) { c.p?.let { runCatching { Crypto.unb64(it) }.getOrNull() }?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
    LaunchedEffect(m.id, m.file) { if (bitmap == null && m.file.isNotBlank()) bitmap = runCatching { repo.photo(m) }.getOrNull() }
    val ratio = ((c.w ?: 4).toFloat() / (c.h ?: 3).coerceAtLeast(1)).coerceIn(0.55f, 1.9f)
    Column {
        Box(Modifier.width(260.dp).aspectRatio(ratio).clip(RoundedCornerShape(17.dp)).background(Color.Black.copy(alpha = 0.15f))) {
            val shown = bitmap ?: preview
            if (shown != null) {
                Image(
                    shown.asImageBitmap(), null, contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().then(if (bitmap == null) Modifier.blur(12.dp) else Modifier),
                )
            }
            if (bitmap == null) androidx.compose.material3.CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), strokeWidth = 2.dp, color = Color.White)
        }
        c.c?.let { EmojiText(it, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), color = onBubble) }
    }
}

@Composable
private fun CallBubble(m: Msg, mine: Boolean, onBubble: Color) {
    val missed = m.content?.s == "missed" || m.content?.s == "declined"
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).background(onBubble.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(
                if (missed) Icons.Filled.CallMissed else if (m.content?.v == true) Icons.Filled.Videocam else Icons.Filled.Call, null,
                tint = if (missed && !mine) Danger else onBubble,
            )
        }
        Column(Modifier.padding(start = 10.dp)) {
            Text(m.callTitle(mine), color = onBubble, fontWeight = FontWeight.SemiBold)
            Text(if (mine) "Исходящий" else "Входящий", color = onBubble.copy(alpha = 0.7f), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun InputBar(
    text: String, onText: (String) -> Unit, replyTo: Msg?, editing: Msg?, peer: User?, myId: String,
    emojiOpen: Boolean, onToggleEmoji: () -> Unit, onCancel: () -> Unit, onAttach: () -> Unit, onSend: () -> Unit, onFocus: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column {
            val banner = editing ?: replyTo
            if (banner != null) {
                Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (editing != null) Icons.Filled.Edit else Icons.AutoMirrored.Filled.Reply, null, tint = Honey)
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(
                            if (editing != null) "Изменение" else "Ответ " + (if (banner.senderId == myId) "себе" else peer?.title.orEmpty()),
                            color = Honey, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        )
                        EmojiText(banner.preview(), maxLines = 1, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Отменить") }
                }
            }
            Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.Bottom) {
                IconButton(onClick = onToggleEmoji) {
                    Icon(if (emojiOpen) Icons.Filled.Keyboard else Icons.Filled.SentimentSatisfied, if (emojiOpen) "Клавиатура" else "Эмодзи", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextField(
                    value = text, onValueChange = onText,
                    placeholder = { Text("Сообщение") },
                    maxLines = 6,
                    shape = RoundedCornerShape(22.dp),
                    colors = TextFieldDefaults.colors(
                        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest, unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                    ),
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).onFocusGained(onFocus),
                )
                if (text.isBlank() && editing == null) {
                    IconButton(onClick = onAttach) { Icon(Icons.Filled.Image, "Фото", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    IconButton(
                        onClick = onSend,
                        modifier = Modifier.padding(start = 4.dp).size(48.dp).background(Brush.linearGradient(listOf(Accent.HONEY.start, Accent.HONEY.end)), CircleShape),
                    ) { Icon(if (editing != null) Icons.Filled.Done else Icons.AutoMirrored.Filled.Send, "Отправить", tint = Color(0xFF241800)) }
                }
            }
        }
    }
}

private fun Modifier.onFocusGained(block: () -> Unit) = this.onFocusChanged { if (it.isFocused) block() }

@Composable
private fun EmojiPanel(onPick: (String) -> Unit, onSendBig: (String) -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val groups = Emoji.groups
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().height(320.dp).navigationBarsPadding()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (groups.isNotEmpty()) {
                ScrollableTabRow(selectedTabIndex = tab, edgePadding = 8.dp, containerColor = Color.Transparent, divider = {}) {
                    groups.forEachIndexed { i, g ->
                        Tab(selected = tab == i, onClick = { tab = i }, text = { Text(g.items.firstOrNull()?.e.orEmpty() + " " + g.title, maxLines = 1) })
                    }
                }
                LazyVerticalGrid(GridCells.Adaptive(48.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(8.dp)) {
                    items(groups[tab].items, key = { it.c }) { item ->
                        Box(
                            Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).combinedClickableSafe(onClick = { onPick(item.e) }, onLongClick = { onSendBig(item.e) }),
                            contentAlignment = Alignment.Center,
                        ) { AnimatedEmoji(item.c, 38.dp) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableSafe(onClick: () -> Unit, onLongClick: () -> Unit) = this.combinedClickable(onClick = onClick, onLongClick = onLongClick)

@Composable
private fun MenuRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, tint: Color = Color.Unspecified, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 22.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint)
        Text(title, Modifier.padding(start = 18.dp), style = MaterialTheme.typography.bodyLarge, color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint)
    }
}

@Composable
private fun PhotoViewer(repo: Repository, m: Msg, onClose: () -> Unit) {
    var bitmap by remember(m.id) { mutableStateOf(repo.cachedPhoto(m)) }
    LaunchedEffect(m.id) { if (bitmap == null) bitmap = runCatching { repo.photo(m) }.getOrNull() }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).clickable(onClick = onClose)) {
            bitmap?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(top = 32.dp, end = 8.dp)) { Icon(Icons.Filled.Close, "Закрыть", tint = Color.White) }
            m.content?.c?.let {
                Text(it, color = Color.White, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.5f)).padding(20.dp), maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SendPhotoDialog(photo: Photos.Prepared, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var caption by remember { mutableStateOf("") }
    val bitmap = remember(photo) { BitmapFactory.decodeByteArray(photo.jpeg, 0, photo.jpeg.size) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Отправить фото") },
        text = {
            Column {
                Image(bitmap.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio((photo.width.toFloat() / photo.height).coerceIn(0.6f, 1.8f)).clip(RoundedCornerShape(16.dp)))
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(caption, { caption = it }, placeholder = { Text("Подпись") }, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth())
                Text("🔒 Фото зашифруется на телефоне перед отправкой", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        },
        confirmButton = { Button(onClick = { onSend(caption) }) { Text("Отправить") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}
