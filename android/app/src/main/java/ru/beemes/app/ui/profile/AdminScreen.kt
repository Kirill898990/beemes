package ru.beemes.app.ui.profile

import ru.beemes.app.ui.toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.beemes.app.data.AdminRow
import ru.beemes.app.data.Repository
import ru.beemes.app.ui.components.Avatar
import ru.beemes.app.ui.components.NameWithStatus
import ru.beemes.app.ui.groups.GroupAvatar
import ru.beemes.app.ui.groups.GroupTitle

/** Админ-панель: выдать или снять галочку человеку и каналу. Видна только админу (users.admin в панели PocketBase). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(repo: Repository, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var kind by remember { mutableStateOf("users") }
    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<AdminRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(kind, query) {
        if (query.isNotBlank()) delay(250)
        runCatching { repo.adminSearch(kind, query) }.onSuccess { items = it; error = null }.onFailure { error = it.message }
    }
    fun toggle(row: AdminRow, on: Boolean) {
        items = items?.map { if (it.id == row.id) it.copy(badge = on) else it }
        scope.launch {
            runCatching { repo.adminBadge(row, on) }
                .onSuccess { r -> items = items?.map { if (it.id == r.id) r else it }; context.toast(if (r.badge) "Галочка выдана" else "Галочка снята") }
                .onFailure { e -> items = items?.map { if (it.id == row.id) row else it }; context.toast(e.message) }
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Админ-панель") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "Галочка ✓ рядом с именем — знак, что аккаунт или канал настоящий. Видна всем.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf("users" to "Люди", "chats" to "Каналы и группы").forEachIndexed { i, (k, label) ->
                    SegmentedButton(selected = kind == k, onClick = { kind = k; items = null }, shape = SegmentedButtonDefaults.itemShape(i, 2), icon = {}) { Text(label, fontSize = 13.sp, maxLines = 1) }
                }
            }
            OutlinedTextField(
                query, { query = it }, singleLine = true, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text(if (kind == "users") "@имя или имя" else "Название или @имя канала") },
            )
            if (query.isBlank()) Text(
                if (kind == "users") "Люди с галочкой. Найдите человека, чтобы выдать." else "Каналы и группы с галочкой. Найдите канал, чтобы выдать.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val list = items
            when {
                error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
                list == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                list.isEmpty() -> Text(
                    if (query.isNotBlank()) "Ничего не нашлось" else if (kind == "users") "Галочек у людей пока нет" else "Галочек у каналов пока нет",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp),
                )
                else -> Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                    LazyColumn {
                        items(list, key = { it.kind + it.id }) { r ->
                            if (r != list.first()) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 70.dp))
                            Row(Modifier.fillMaxWidth().clickable { toggle(r, !r.badge) }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (r.kind == "user") Avatar(r.user, 44.dp) else GroupAvatar(r.id, r.type == "channel", 44.dp, photo = r.photo)
                                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                    if (r.kind == "user") NameWithStatus(r.user, MaterialTheme.typography.bodyLarge, emojiSize = 18.dp)
                                    else GroupTitle(r.title, r.type == "channel", style = MaterialTheme.typography.bodyLarge, badge = r.badge)
                                    Text(
                                        if (r.kind == "user") "@${r.username}"
                                        else listOf(if (r.handle.isNotBlank()) "@${r.handle}" else if (!r.isPublic) "приватный" else "", if (r.type == "channel") "канал" else "группа", "${r.membersCount} уч.")
                                            .filter { it.isNotBlank() }.joinToString(" · "),
                                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Switch(r.badge, { toggle(r, it) })
                            }
                        }
                        item { androidx.compose.foundation.layout.Spacer(Modifier.navigationBarsPadding()) }
                    }
                }
            }
        }
    }
}
