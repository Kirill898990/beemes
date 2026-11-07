package ru.beemes.app.ui.groups

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.beemes.app.data.Chat
import ru.beemes.app.data.GroupMember
import ru.beemes.app.data.GroupPreview
import ru.beemes.app.data.Repository
import ru.beemes.app.data.User
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.components.HexShape
import ru.beemes.app.ui.components.NameWithStatus
import ru.beemes.app.ui.theme.Accent
import ru.beemes.app.ui.theme.Danger

/** Аватар группы/канала: сота цвета по id и значок. */
@Composable
fun GroupAvatar(id: String, channel: Boolean, size: Dp, modifier: Modifier = Modifier) {
    val accent = Accent.forUser("", id)
    Box(modifier.size(size).clip(HexShape).background(accent.brush), contentAlignment = Alignment.Center) {
        Icon(if (channel) Icons.Filled.Campaign else Icons.Filled.Groups, null, Modifier.size(size * 0.5f), tint = accent.onColor)
    }
}

/** Название группы со значком. */
@Composable
fun GroupTitle(title: String, channel: Boolean, modifier: Modifier = Modifier, style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.titleMedium, color: Color = Color.Unspecified) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(if (channel) Icons.Filled.Campaign else Icons.Filled.Groups, null, Modifier.size(18.dp).padding(end = 2.dp), tint = if (color == Color.Unspecified) MaterialTheme.colorScheme.onSurface else color)
        Text(title.ifBlank { "Группа" }, style = style, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 4.dp))
    }
}

@Composable
private fun TopBar(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(60.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PickPeople(people: List<User>, chosen: MutableList<String>) {
    if (people.isEmpty()) {
        Text("Пока не с кем: сначала напишите кому-нибудь в личку — потом его можно будет добавить.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
        return
    }
    people.forEach { u ->
        val on = u.id in chosen
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { if (on) chosen.remove(u.id) else chosen.add(u.id) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(on, { if (it) chosen.add(u.id) else chosen.remove(u.id) })
            Avatar(u, 40.dp)
            Column(Modifier.padding(start = 12.dp)) {
                NameWithStatus(u, MaterialTheme.typography.bodyLarge, emojiSize = 16.dp)
                Text("@${u.username}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ======================= Новая группа / новый канал =======================

@Composable
fun NewGroupScreen(repo: Repository, type: String, onBack: () -> Unit, onCreated: (String) -> Unit) {
    val channel = type == "channel"
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var about by rememberSaveable { mutableStateOf("") }
    var public by rememberSaveable { mutableStateOf(false) }
    var handle by rememberSaveable { mutableStateOf("") }
    val chosen = remember { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(if (channel) "Новый канал" else "Новая группа", onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(title, { title = it.take(64) }, label = { Text("Название") }, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(about, { about = it.take(255) }, label = { Text("Описание") }, maxLines = 3, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth())
            if (channel) {
                Choice(!public, "Приватный", "Вступают по ссылке-приглашению. Посты зашифрованы — сервер их не видит.") { public = false }
                Choice(public, "Публичный", "Его найдёт любой в поиске и сможет читать. Посты видны всем.") { public = true }
                if (public) OutlinedTextField(
                    handle, { handle = it.lowercase().replace(" ", "").removePrefix("@").take(32) }, label = { Text("@имя канала") }, singleLine = true,
                    supportingText = { Text("По нему канал найдут в поиске. Латиница, цифры и _, от 4 символов.") },
                    shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                )
            }
            Text(if (channel) "Подписчики (можно позже по ссылке)" else "Участники", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            PickPeople(repo.contacts(), chosen)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Button(
            onClick = {
                if (title.isBlank()) { error = "Впишите название"; return@Button }
                busy = true; error = null
                scope.launch {
                    runCatching { repo.createGroup(if (channel) "channel" else "group", title, about, chosen.toList(), channel && public, handle) }
                        .onSuccess { onCreated(it.id) }.onFailure { error = it.message }
                    busy = false
                }
            },
            enabled = !busy, modifier = Modifier.fillMaxWidth().padding(16.dp).navigationBarsPadding().height(54.dp), shape = RoundedCornerShape(18.dp),
        ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (channel) "Создать канал" else "Создать группу", fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun Choice(selected: Boolean, title: String, text: String, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().selectable(selected, role = Role.RadioButton, onClick = onClick)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            RadioButton(selected, null)
            Column(Modifier.padding(start = 10.dp)) {
                Text(title, fontWeight = FontWeight.Bold)
                Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ======================= О группе / о канале =======================

@Composable
fun GroupInfoScreen(repo: Repository, chatId: String, onBack: () -> Unit, onOpenChat: (String) -> Unit, onOpenProfile: (String) -> Unit, onLeft: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val myId = me?.id.orEmpty()
    var chat by remember { mutableStateOf<Chat?>(null) }
    var members by remember { mutableStateOf<List<GroupMember>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    suspend fun load() {
        val c = repo.reloadChat(chatId)
        runCatching { repo.ensureGroupKey(c) }
        chat = c
        members = if (!c.isChannel || c.isAdmin(myId)) runCatching { repo.groupMembers(chatId) }.getOrNull() else null
    }
    LaunchedEffect(chatId) { runCatching { load() }.onFailure { message = it.message } }
    val c = chat
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        if (c == null) { TopBar("", onBack); message?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) }; return@Column }
        val admin = c.isAdmin(myId)
        val owner = c.owner == myId
        val link = if (admin || c.isPublic) repo.inviteLink(c) else ""
        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Box(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFF7D5CFF), Color(0xFFFF5E8A))))) {
                    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(bottom = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Row(Modifier.fillMaxWidth()) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад", tint = Color.White) } }
                        GroupAvatar(c.id, c.isChannel, 116.dp)
                        Spacer(Modifier.height(12.dp))
                        GroupTitle(c.title, c.isChannel, style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold), color = Color.White)
                        Text(c.subtitle + (if (c.handle.isNotBlank()) " · @${c.handle}" else ""), color = Color.White.copy(alpha = 0.85f))
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Quick(Icons.AutoMirrored.Filled.Chat, if (c.isChannel) "Читать" else "Написать", Modifier.weight(1f)) { onOpenChat(c.id) }
                    if (link.isNotBlank()) Quick(Icons.Filled.Link, "Поделиться", Modifier.weight(1f)) {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Пригласить"))
                    }
                    if (admin && !c.isPublic) Quick(Icons.Filled.PersonAdd, "Добавить", Modifier.weight(1f)) { adding = true }
                }
            }
            if (c.about.isNotBlank()) item { Section("Описание") { Text(c.about, Modifier.padding(14.dp)) } }
            if (link.isNotBlank()) item {
                Section("Ссылка-приглашение") {
                    Text(link, Modifier.padding(14.dp).clickable { clipboard.setText(AnnotatedString(link)); message = "Ссылка скопирована" }, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (admin && !c.isPublic) TextButton(onClick = { scope.launch { runCatching { chat = repo.newInvite(c.id); message = "Старая ссылка больше не работает" }.onFailure { message = it.message } } }, modifier = Modifier.padding(start = 6.dp)) { Text("Новая ссылка") }
                }
            }
            if (admin) item { Section("Настройки") { Row(Modifier.fillMaxWidth().clickable { editing = true }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.Edit, null, tint = MaterialTheme.colorScheme.primary); Text("Название и описание", Modifier.padding(start = 12.dp)) } } }
            members?.let { list ->
                item { Text("${if (c.isChannel) "Подписчики" else "Участники"} (${list.size})", Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary) }
                items(list, key = { it.id }) { m -> MemberRow(m, myId, owner, admin, onOpenProfile,
                    onAdmin = { scope.launch { runCatching { repo.setAdmin(c.id, m.id, !m.admin); load() }.onFailure { message = it.message } } },
                    onRemove = { scope.launch { runCatching { repo.removeMember(c.id, m.id); load(); message = "Исключён. Ключ шифрования сменили." }.onFailure { message = it.message } } }) }
            }
            item {
                Column(Modifier.padding(16.dp)) {
                    message?.let { Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 8.dp)) }
                    if (c.joined) TextButton(onClick = { confirm = "leave" }) { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = Danger); Text(if (c.isChannel) "  Отписаться" else "  Выйти из группы", color = Danger) }
                    if (owner) TextButton(onClick = { confirm = "delete" }) { Icon(Icons.Filled.DeleteForever, null, tint = Danger); Text(if (c.isChannel) "  Удалить канал" else "  Удалить группу", color = Danger) }
                    Spacer(Modifier.navigationBarsPadding())
                }
            }
        }
        if (adding) {
            val chosen = remember { mutableStateListOf<String>() }
            val already = members.orEmpty().map { it.id }.toSet()
            AlertDialog(
                onDismissRequest = { adding = false },
                title = { Text("Добавить участников") },
                text = { Column(Modifier.verticalScroll(rememberScrollState())) { PickPeople(repo.contacts().filter { it.id !in already }, chosen) } },
                confirmButton = { TextButton(onClick = { adding = false; scope.launch { runCatching { repo.addMembers(c.id, chosen.toList()); load(); message = "Добавлены" }.onFailure { message = it.message } } }) { Text("Добавить") } },
                dismissButton = { TextButton(onClick = { adding = false }) { Text("Отмена") } },
            )
        }
        if (editing) {
            var t by remember { mutableStateOf(c.title) }
            var a by remember { mutableStateOf(c.about) }
            AlertDialog(
                onDismissRequest = { editing = false },
                title = { Text("Название и описание") },
                text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(t, { t = it.take(64) }, label = { Text("Название") }, singleLine = true); OutlinedTextField(a, { a = it.take(255) }, label = { Text("Описание") }) } },
                confirmButton = { TextButton(onClick = { editing = false; scope.launch { runCatching { repo.updateGroup(c.id, t, a); load() }.onFailure { message = it.message } } }) { Text("Сохранить") } },
                dismissButton = { TextButton(onClick = { editing = false }) { Text("Отмена") } },
            )
        }
        confirm?.let { what ->
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text(if (what == "delete") "Удалить совсем?" else if (c.isChannel) "Отписаться от канала?" else "Выйти из группы?") },
                text = { Text(if (what == "delete") "Группа и все сообщения исчезнут у всех участников." else "Вернуться можно будет по ссылке-приглашению.") },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        scope.launch { runCatching { if (what == "delete") repo.deleteGroup(c.id) else repo.leaveGroup(c.id) }.onSuccess { onLeft() }.onFailure { message = it.message } }
                    }) { Text(if (what == "delete") "Удалить" else "Да", color = Danger) }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("Отмена") } },
            )
        }
    }
}

@Composable
private fun Quick(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = modifier) {
        Column(Modifier.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Text(label, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
        Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) { Column { content() } }
    }
}

@Composable
private fun MemberRow(m: GroupMember, myId: String, owner: Boolean, admin: Boolean, onOpenProfile: (String) -> Unit, onAdmin: () -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val canManage = m.id != myId && !m.owner && (owner || (admin && !m.admin))
    Row(Modifier.fillMaxWidth().clickable { onOpenProfile(m.id) }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m.toUser(), 42.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            NameWithStatus(m.toUser(), MaterialTheme.typography.bodyLarge, emojiSize = 16.dp)
            Text("@${m.username}" + if (m.hasKey) "" else " · ждёт ключ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val role = if (m.owner) "владелец" else if (m.admin) "админ" else ""
        if (role.isNotBlank()) Text(role, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 2.dp))
        if (canManage) Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Действия") }
            DropdownMenu(menu, { menu = false }) {
                if (owner) DropdownMenuItem(text = { Text(if (m.admin) "Снять с админов" else "Сделать админом") }, onClick = { menu = false; onAdmin() })
                DropdownMenuItem(text = { Text("Исключить", color = Danger) }, onClick = { menu = false; onRemove() })
            }
        }
    }
}

// ======================= Вступить по ссылке =======================

@Composable
fun JoinScreen(repo: Repository, link: String, onBack: () -> Unit, onJoined: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val invite = remember(link) { repo.parseInvite(link) }
    var preview by remember { mutableStateOf<GroupPreview?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(link) {
        when {
            invite == null -> error = "Это не ссылка-приглашение beemes"
            invite.handle.isNotBlank() -> repo.channelByHandle(invite.handle)?.let { onJoined(it.id) } ?: run { error = "Канал @${invite.handle} не найден" }
            else -> runCatching { repo.invitePreview(invite.code) }.onSuccess { if (it.joined) onJoined(it.id) else preview = it }.onFailure { error = it.message }
        }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar("Приглашение", onBack)
        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val p = preview
            when {
                error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                p == null -> CircularProgressIndicator()
                else -> {
                    GroupAvatar(p.id, p.type == "channel", 110.dp)
                    GroupTitle(p.title, p.type == "channel", style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold))
                    Text(Chat(type = p.type, isPublic = p.isPublic, membersCount = p.membersCount).subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (p.about.isNotBlank()) Text(p.about, textAlign = TextAlign.Center)
                    if (invite?.key?.isNotBlank() == true) Text("🔒 Сообщения зашифрованы, ключ — в самой ссылке.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(
                        onClick = { busy = true; scope.launch { runCatching { repo.joinByInvite(invite!!) }.onSuccess { onJoined(it.id) }.onFailure { error = it.message }; busy = false } },
                        enabled = !busy, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp),
                    ) { Text(if (p.type == "channel") "Подписаться" else "Вступить в группу", fontWeight = FontWeight.Bold) }
                    TextButton(onClick = onBack) { Text("Не сейчас") }
                }
            }
        }
    }
}
