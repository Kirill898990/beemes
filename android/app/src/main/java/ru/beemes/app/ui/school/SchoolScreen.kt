package ru.beemes.app.ui.school

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.beemes.app.data.Repository
import ru.beemes.app.data.School
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.components.HexShape
import ru.beemes.app.ui.openUrl
import ru.beemes.app.ui.theme.Danger
import ru.beemes.app.ui.theme.Honey
import ru.beemes.app.ui.theme.HoneyDeep
import ru.beemes.app.ui.theme.Online
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Учебный профиль «Простой химии»: подключение и оценки за работы. Видно только владельцу телефона. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchoolScreen(repo: Repository, onBack: () -> Unit) {
    val school = repo.school
    val student by school.student.collectAsState()
    val works by school.works.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOff by remember { mutableStateOf(false) }

    fun refresh() = scope.launch {
        refreshing = true
        error = runCatching { school.refresh() }.exceptionOrNull()?.message
        refreshing = false
    }
    LaunchedEffect(student?.id) { if (student != null) refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Учебный профиль") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                actions = {
                    if (student != null) IconButton(onClick = { confirmOff = true }) { Icon(Icons.Filled.LinkOff, "Отключить") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val s = student
        when {
            s == null -> ConnectForm(repo, Modifier.padding(padding))
            s.isTeacher -> TeacherNote(repo, s, Modifier.padding(padding))
            else -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refresh() }, modifier = Modifier.fillMaxSize().padding(padding)) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { Summary(s, works) }
                    error?.let { e -> item { Text(e, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 4.dp)) } }
                    if (works.isEmpty() && !refreshing) {
                        item {
                            Column(Modifier.fillMaxWidth().padding(top = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                AnimatedEmoji("1f4da", 88.dp)
                                Text("Пока нет сданных работ", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                                Text("Когда учитель проверит работу, оценка появится здесь.", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                            }
                        }
                    } else {
                        item { Text("Работы", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp)) }
                        items(works, key = { it.id }) { WorkRow(it) }
                    }
                    item {
                        Text(
                            "🔒 Оценки загружаются с сайта «Простой химии» прямо на ваш телефон и видны только вам. На сервер beemes они не попадают.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        )
                    }
                }
            }
        }
    }
    if (confirmOff) {
        AlertDialog(
            onDismissRequest = { confirmOff = false },
            title = { Text("Отключить учебный профиль?") },
            text = { Text("Оценки пропадут из beemes на этом телефоне. На сайте «Простой химии» ничего не изменится, подключить можно снова в любой момент.") },
            confirmButton = { TextButton(onClick = { confirmOff = false; school.disconnect() }) { Text("Отключить", color = Danger) } },
            dismissButton = { TextButton(onClick = { confirmOff = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun ConnectForm(repo: Repository, modifier: Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var login by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(12.dp))
        AnimatedEmoji("1f4da", 104.dp)
        Text("Простая химия", fontSize = 28.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(top = 8.dp))
        Text(
            "Подключите свой аккаунт «Простой химии» — и оценки за работы и контрольные будут видны прямо в beemes.",
            textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
        )
        OutlinedTextField(
            login, { login = it.trim(); error = null }, label = { Text("Логин в «Простой химии»") }, singleLine = true,
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(), enabled = !busy,
        )
        OutlinedTextField(
            password, { password = it; error = null }, label = { Text("Пароль") }, singleLine = true,
            visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, "Показать пароль") } },
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp), enabled = !busy,
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp), textAlign = TextAlign.Center) }
        Button(
            onClick = {
                busy = true
                scope.launch {
                    error = runCatching { repo.school.connect(login, password) }.exceptionOrNull()?.message
                    if (error == null) password = ""
                    busy = false
                }
            },
            enabled = !busy && login.isNotBlank() && password.isNotBlank(),
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(52.dp),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text("Подключить", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
        Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(top = 20.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("🔒 Только для вас", fontWeight = FontWeight.SemiBold)
                Text(
                    "Оценки загружаются с сайта школы прямо на этот телефон. Сервер beemes и ваши собеседники их не видят. " +
                        "Пароль не сохраняется — телефон помнит только вход, и его можно отключить в любой момент.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        TextButton(onClick = { context.openUrl(repo.school.siteUrl) }, modifier = Modifier.padding(top = 8.dp)) { Text("Нет аккаунта? Сайт «Простая химия»") }
    }
}

@Composable
private fun TeacherNote(repo: Repository, s: School.Student, modifier: Modifier) {
    val context = LocalContext.current
    Column(modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        AnimatedEmoji("1f4da", 96.dp)
        Text(s.name.ifBlank { s.username }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
        Text(
            "Это аккаунт учителя. Оценки учеников — в журнале на сайте «Простой химии».",
            textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
        )
        Button(onClick = { context.openUrl(repo.school.siteUrl) }, modifier = Modifier.padding(top = 16.dp)) { Text("Открыть журнал") }
    }
}

@Composable
private fun Summary(s: School.Student, works: List<School.Work>) {
    val avg = School.average(works)
    val graded = works.count { it.graded }
    val waiting = works.count { !it.graded }
    Box(
        Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFFFFC23D), HoneyDeep)), RoundedCornerShape(26.dp)).padding(20.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Простая химия", color = Color(0xFF241800).copy(alpha = 0.7f), style = MaterialTheme.typography.labelLarge)
                    Text(s.name.ifBlank { s.username }, color = Color(0xFF241800), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text(listOfNotNull("@${s.username}", s.group.takeIf { it.isNotBlank() }?.let { "класс $it" }).joinToString(" · "), color = Color(0xFF241800).copy(alpha = 0.75f))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (avg != null && avg.replace(',', '.').toDouble() >= 4.5) AnimatedEmoji("1f3c6", 40.dp)
                    Text(avg ?: "—", color = Color(0xFF241800), fontSize = 40.sp, fontWeight = FontWeight.Black)
                    Text("средний балл", color = Color(0xFF241800).copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium)
                }
            }
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Оценок: $graded")
                if (waiting > 0) Chip("На проверке: $waiting")
            }
        }
    }
}

@Composable
private fun Chip(text: String) {
    Text(
        text, color = Color(0xFF241800), style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.background(Color.White.copy(alpha = 0.35f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

private val dateFormat = DateTimeFormatter.ofPattern("d MMMM", Locale.forLanguageTag("ru")).withZone(ZoneId.systemDefault())

/** Цвет оценки: 5 — зелёный, 4 — салатовый, 3 — медовый, 2 и 1 — красный. */
private fun gradeColor(grade: Int): Color = when (grade) {
    5 -> Online
    4 -> Color(0xFF9BD13A)
    3 -> Honey
    else -> Danger
}

@Composable
private fun WorkRow(w: School.Work) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (w.graded) {
                    Box(Modifier.size(46.dp, 52.dp).background(gradeColor(w.grade), HexShape), contentAlignment = Alignment.Center) {
                        Text("${w.grade}", color = if (w.grade == 3 || w.grade == 4) Color(0xFF241800) else Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    }
                } else {
                    Box(Modifier.size(46.dp, 52.dp).border(BorderStroke(2.dp, MaterialTheme.colorScheme.outline), HexShape), contentAlignment = Alignment.Center) {
                        Text("⏳", fontSize = 18.sp)
                    }
                }
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text(w.practiceTitle, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2)
                    val parts = listOfNotNull(
                        w.createdAt?.let { dateFormat.format(it) },
                        if (w.total > 0) "${w.solved} из ${w.total}" else null,
                        if (!w.graded) "на проверке" else null,
                    )
                    Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val tags = listOfNotNull(
                        if (w.exam) "Контрольная" else null,
                        if (w.course) "Курс" else null,
                        if (w.subject == "biology") "Биология" else null,
                        if (w.overtime) "после срока" else null,
                    )
                    if (tags.isNotEmpty()) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        tags.forEach { t ->
                            Text(
                                t, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }
            if (w.comment.isNotBlank()) {
                Row(Modifier.padding(top = 10.dp).fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(14.dp)).padding(10.dp)) {
                    Box(Modifier.size(3.dp, 36.dp).background(Honey, RoundedCornerShape(2.dp)))
                    Column(Modifier.padding(start = 10.dp)) {
                        Text("Комментарий учителя", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(w.comment, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
