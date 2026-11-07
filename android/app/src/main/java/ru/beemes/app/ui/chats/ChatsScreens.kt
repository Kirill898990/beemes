package ru.beemes.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.beemes.app.data.ChatItem
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Groups
import ru.beemes.app.ui.groups.GroupTitle
import ru.beemes.app.ui.groups.GroupAvatar
import ru.beemes.app.data.PresenceClock
import ru.beemes.app.data.Repository
import ru.beemes.app.data.SendStatus
import ru.beemes.app.data.User
import ru.beemes.app.data.shortWhen
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.components.EmojiText
import ru.beemes.app.ui.components.NameWithStatus
import ru.beemes.app.ui.theme.Honey
import ru.beemes.app.ui.theme.Online

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(repo: Repository, onOpenChat: (String) -> Unit, onSearch: () -> Unit, onSettings: () -> Unit, onNewGroup: (String) -> Unit = {}) {
    val chats by repo.chats.collectAsState()
    val users by repo.users.collectAsState()
    val me by repo.me.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(chats.isNotEmpty()) }
    var menuFor by remember { mutableStateOf<ChatItem?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { repo.refreshChats() }.onFailure { error = it.message }
        loaded = true
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        buildAnnotatedString {
                            append("bee"); withStyle(SpanStyle(color = Honey)) { append("mes") }
                        },
                        fontWeight = FontWeight.Black, fontSize = 26.sp, letterSpacing = (-0.5).sp,
                    )
                },
                actions = {
                    IconButton(onClick = onSearch) { Icon(Icons.Filled.Search, "Найти людей") }
                    IconButton(onClick = onSettings, modifier = Modifier.semantics { contentDescription = "Настройки" }) {
                        me?.let { Avatar(it, 32.dp) } ?: Icon(Icons.Filled.Settings, null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            var newMenu by remember { mutableStateOf(false) }
            Box {
                FloatingActionButton(onClick = { newMenu = true }, containerColor = Honey, shape = RoundedCornerShape(20.dp)) {
                    Icon(Icons.Filled.Edit, "Новый чат")
                }
                androidx.compose.material3.DropdownMenu(newMenu, { newMenu = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Написать человеку") }, leadingIcon = { Icon(Icons.Filled.Search, null) }, onClick = { newMenu = false; onSearch() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Новая группа") }, leadingIcon = { Icon(Icons.Filled.Groups, null) }, onClick = { newMenu = false; onNewGroup("group") })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Новый канал") }, leadingIcon = { Icon(Icons.Filled.Campaign, null) }, onClick = { newMenu = false; onNewGroup("channel") })
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; runCatching { repo.refreshChats() }; refreshing = false } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            val visible = chats.filter { !it.hidden }
            if (loaded && visible.isEmpty()) {
                EmptyChats(error, onSearch)
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                    items(visible, key = { it.chat.id }) { item ->
                        ChatRow(if (item.chat.isGroup) item else item.copy(peer = users[item.peer.id] ?: item.peer), me?.id.orEmpty(), { onOpenChat(item.chat.id) }, { menuFor = item }, users)
                    }
                }
            }
        }
    }
    menuFor?.let { item ->
        AlertDialog(
            onDismissRequest = { menuFor = null },
            title = { Text(item.peer.title) },
            text = {
                Column {
                    TextButton(onClick = { scope.launch { runCatching { repo.setMuted(item.chat.id, !item.muted) } }; menuFor = null }) {
                        Text(if (item.muted) "🔔 Включить звук" else "🔕 Без звука")
                    }
                    TextButton(onClick = { scope.launch { runCatching { repo.hideChat(item.chat.id) } }; menuFor = null }) {
                        Text("🗑️ Убрать из списка")
                    }
                }
            },
            confirmButton = { TextButton(onClick = { menuFor = null }) { Text("Закрыть") } },
        )
    }
}

@Composable
private fun EmptyChats(error: String?, onSearch: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        AnimatedEmoji("1f41d", 120.dp)
        Spacer(Modifier.height(12.dp))
        Text(error ?: "Здесь будут ваши чаты", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(
            "Найдите друга по @имени и напишите первым. Вся переписка шифруется на телефоне.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Spacer(Modifier.height(18.dp))
        androidx.compose.material3.Button(onClick = onSearch, shape = RoundedCornerShape(16.dp)) { Text("Найти людей") }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(item: ChatItem, myId: String, onClick: () -> Unit, onLongClick: () -> Unit, users: Map<String, User> = emptyMap()) {
    val group = item.chat.isGroup
    Row(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            if (group) GroupAvatar(item.chat.id, item.chat.isChannel, 56.dp) else Avatar(item.peer, 56.dp)
            val now by PresenceClock.now.collectAsState()
            if (!group && item.peer.onlineAt(now)) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(2.dp).size(14.dp).background(MaterialTheme.colorScheme.background, CircleShape).padding(2.5.dp).background(Online, CircleShape),
                )
            }
        }
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (group) GroupTitle(item.chat.title, item.chat.isChannel, Modifier.weight(1f))
                else NameWithStatus(item.peer, MaterialTheme.typography.titleMedium, Modifier.weight(1f), emojiSize = 18.dp)
                if (item.muted) Icon(Icons.AutoMirrored.Filled.VolumeOff, "Без звука", Modifier.size(15.dp).padding(start = 2.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                val last = item.last
                if (last != null && last.senderId == myId && !item.chat.isChannel) {
                    val read = item.peerReadAt?.let { !last.created.isAfter(it) } == true || last.status == SendStatus.READ
                    Icon(if (read) Icons.Filled.DoneAll else Icons.Filled.Done, null, Modifier.padding(start = 6.dp).size(16.dp), tint = Honey)
                }
                Text(
                    last?.created?.let { shortWhen(it) }.orEmpty(),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp),
                )
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val preview = item.last?.let {
                    // в группе — «Алиса: текст», в канале — просто текст
                    val who = if (it.senderId == myId) (if (item.chat.isChannel) "" else "Вы: ")
                        else if (group && !item.chat.isChannel) users[it.senderId]?.let { u -> u.title.substringBefore(' ') + ": " }.orEmpty() else ""
                    who + it.preview()
                } ?: if (group) (if (item.chat.isChannel) "Канал создан" else "Группа создана") else "Начните переписку 👋"
                EmojiText(preview, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                AnimatedVisibility(item.unread > 0) {
                    Box(
                        Modifier.padding(start = 8.dp).height(22.dp).background(if (item.muted) MaterialTheme.colorScheme.outline else Honey, RoundedCornerShape(11.dp)).padding(horizontal = 7.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (item.unread > 99) "99+" else item.unread.toString(), color = MaterialTheme.colorScheme.onPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(repo: Repository, onBack: () -> Unit, onOpenProfile: (String) -> Unit, onOpenChat: (String) -> Unit = {}, onInvite: (String) -> Unit = {}) {
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<User>>(emptyList()) }
    var channels by remember { mutableStateOf<List<ru.beemes.app.data.GroupPreview>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val invite = remember(query) { repo.parseInvite(query) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        if (query.trim().removePrefix("@").length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        searching = true
        if (repo.parseInvite(query) == null) {
            results = runCatching { repo.search(query) }.getOrDefault(emptyList())
            channels = repo.searchChannels(query.trim())
        }
        searching = false
    }
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                title = {
                    OutlinedTextField(
                        value = query, onValueChange = { query = it }, singleLine = true,
                        placeholder = { Text("@имя, канал или ссылка") },
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth().padding(end = 12.dp).focusRequester(focus),
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (query.trim().length < 2) {
                item {
                    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        AnimatedEmoji("1f440", 72.dp)
                        Text("Найдите человека по @имени", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            } else if (invite != null) {
                item {
                    Row(Modifier.fillMaxWidth().clickable { onInvite(query.trim()) }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Link, null, tint = Honey)
                        Text("Открыть приглашение", Modifier.padding(start = 14.dp), style = MaterialTheme.typography.titleMedium)
                    }
                }
            } else if (!searching && results.isEmpty() && channels.isEmpty()) {
                item { Text("Никого не нашли", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (channels.isNotEmpty()) item { Text("Каналы", Modifier.padding(start = 18.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = Honey) }
            items(channels, key = { "c" + it.id }) { c ->
                Row(Modifier.fillMaxWidth().clickable { onOpenChat(c.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    GroupAvatar(c.id, true, 50.dp)
                    Column(Modifier.padding(start = 14.dp)) {
                        GroupTitle(c.title, true)
                        Text("@${c.handle} · ${ru.beemes.app.data.Chat(type = "channel", isPublic = true, membersCount = c.membersCount).subtitle}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (channels.isNotEmpty() && results.isNotEmpty()) item { Text("Люди", Modifier.padding(start = 18.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = Honey) }
            items(results, key = { it.id }) { u ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpenProfile(u.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(u, 50.dp)
                    Column(Modifier.padding(start = 14.dp)) {
                        NameWithStatus(u, MaterialTheme.typography.titleMedium, emojiSize = 18.dp)
                        Text("@${u.username}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
