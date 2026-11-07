package ru.beemes.app.ui.profile

import android.graphics.Bitmap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PhoneIphone
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Shield
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch
import ru.beemes.app.data.DeviceSession
import ru.beemes.app.data.QrInfo
import ru.beemes.app.data.Repository
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.theme.Danger
import ru.beemes.app.ui.theme.Online
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val HOW = mapOf("password" to "вход по паролю", "qr" to "вход по QR-коду", "otp" to "вход по коду")
private val PLATFORM = mapOf("android" to "Android", "iphone" to "iPhone", "web" to "Браузер", "windows" to "Windows")

private fun whenText(value: String): String {
    val t = runCatching { Instant.parse(value.trim().replace(" ", "T")) }.getOrNull() ?: return ""
    val min = Duration.between(t, Instant.now()).toMinutes()
    if (min < 2) return "активно только что"
    if (min < 60) return "$min мин. назад"
    return DateTimeFormatter.ofPattern("d MMMM, HH:mm", Locale.forLanguageTag("ru")).withZone(ZoneId.systemDefault()).format(t)
}

private fun deviceSubtitle(s: DeviceSession) =
    listOf(if (s.ip.isNotBlank()) "IP ${s.ip}" else "", HOW[s.how].orEmpty(), if (s.current) "это устройство" else whenText(s.lastActive))
        .filter { it.isNotBlank() }.joinToString(" · ")

/** Открыть сканер QR-кода (камера). В ответ — текст из QR или null, если закрыли. */
@Composable
fun rememberQrScanner(onResult: (String?) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ScanContract()) { onResult(it.contents) }
    return {
        launcher.launch(
            ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Наведите камеру на QR-код на экране нового устройства")
                .setBeepEnabled(false).setOrientationLocked(false),
        )
    }
}

// ======================= Устройства =======================

/** Где вы вошли: устройство, IP-адрес, когда было в сети. Можно завершить сеанс и подключить новое устройство по QR. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(repo: Repository, onBack: () -> Unit, onQr: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var list by remember { mutableStateOf<List<DeviceSession>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var ending by remember { mutableStateOf<DeviceSession?>(null) }
    var endingOthers by remember { mutableStateOf(false) }
    fun load() = scope.launch { runCatching { repo.sessions() }.onSuccess { list = it; error = null }.onFailure { error = it.message } }
    LaunchedEffect(Unit) { load() }
    val scan = rememberQrScanner { text ->
        if (text == null) return@rememberQrScanner
        if (repo.parseQr(text) != null) onQr(text)
        else Toast.makeText(context, "Это не QR-код для входа в beemes", Toast.LENGTH_SHORT).show()
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Устройства") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            Button(
                onClick = scan,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).height(54.dp), shape = RoundedCornerShape(18.dp),
            ) {
                Icon(Icons.Filled.QrCodeScanner, null)
                Text("Подключить устройство", Modifier.padding(start = 10.dp), fontWeight = FontWeight.Bold)
            }
            Text(
                "На компьютере откройте beemes.ru/web (или приложение для Windows) → «Войти по QR-коду» и наведите камеру. Пароль вводить не нужно.",
                Modifier.padding(horizontal = 24.dp, vertical = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Section("Где вы вошли") {
                when {
                    error != null -> Text(error!!, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                    list == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> list!!.forEachIndexed { i, s ->
                        if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 72.dp))
                        DeviceRow(s, onEnd = { ending = s })
                    }
                }
            }
            if (list.orEmpty().any { !it.current }) {
                TextButton(onClick = { endingOthers = true }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Text("Завершить все другие сеансы", color = Danger, fontWeight = FontWeight.SemiBold)
                }
            }
            Text(
                "Не узнаёте устройство — завершите его сеанс: там нужно будет войти заново.",
                Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.navigationBarsPadding().height(16.dp))
        }
    }
    ending?.let { s ->
        AlertDialog(
            onDismissRequest = { ending = null },
            title = { Text("Завершить сеанс?") },
            text = { Text("На устройстве «${s.name}» нужно будет войти заново.") },
            confirmButton = {
                TextButton(onClick = {
                    ending = null
                    scope.launch {
                        runCatching { repo.endSession(s.id) }.onSuccess { Toast.makeText(context, "Сеанс завершён", Toast.LENGTH_SHORT).show(); load() }
                            .onFailure { Toast.makeText(context, it.message, Toast.LENGTH_SHORT).show() }
                    }
                }) { Text("Завершить", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { ending = null }) { Text("Отмена") } },
        )
    }
    if (endingOthers) {
        AlertDialog(
            onDismissRequest = { endingOthers = false },
            title = { Text("Завершить все другие сеансы?") },
            text = { Text("На всех устройствах, кроме этого, нужно будет войти заново.") },
            confirmButton = {
                TextButton(onClick = {
                    endingOthers = false
                    scope.launch {
                        runCatching { repo.endOtherSessions() }.onSuccess { Toast.makeText(context, "Завершено: $it", Toast.LENGTH_SHORT).show(); load() }
                            .onFailure { Toast.makeText(context, it.message, Toast.LENGTH_SHORT).show() }
                    }
                }) { Text("Завершить все", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { endingOthers = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun DeviceRow(s: DeviceSession, onEnd: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(
                when (s.platform) { "iphone" -> Icons.Filled.PhoneIphone; "web" -> Icons.Filled.Language; "windows" -> Icons.Filled.Computer; else -> Icons.Filled.PhoneAndroid },
                null, tint = MaterialTheme.colorScheme.primary,
            )
        }
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Text(s.name.ifBlank { PLATFORM[s.platform] ?: "Устройство" }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(deviceSubtitle(s), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (s.current) {
            Surface(shape = RoundedCornerShape(10.dp), color = Online.copy(alpha = 0.16f)) {
                Text("вы здесь", Modifier.padding(horizontal = 10.dp, vertical = 4.dp), color = Online, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        } else if (onEnd != null) {
            TextButton(onClick = onEnd) { Text("Завершить", color = Danger) }
        }
    }
}

// ======================= Подтвердить вход нового устройства =======================

/** Отсканировали QR-код нового устройства (или открыли ссылку из него): показываем, что за устройство, и спрашиваем. */
@Composable
fun QrApproveScreen(repo: Repository, link: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val qr = remember(link) { repo.parseQr(link) }
    var info by remember { mutableStateOf<QrInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    LaunchedEffect(link) {
        if (qr == null) { error = "Это не QR-код для входа в beemes"; return@LaunchedEffect }
        runCatching { repo.qrInfo(qr.id) }.onSuccess { info = it }.onFailure { error = it.message }
    }
    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text("Вход по QR-коду") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when {
                done -> {
                    AnimatedEmoji("2705", 96.dp)
                    Text("Готово", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("«${info?.name.orEmpty()}» вошло в ваш аккаунт.", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = onBack, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp)) { Text("Хорошо") }
                }
                error != null -> {
                    AnimatedEmoji("1f615", 96.dp)
                    Text("QR-код не работает", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(error!!, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp)) { Text("Назад") }
                }
                info == null -> CircularProgressIndicator(Modifier.padding(32.dp))
                else -> {
                    val i = info!!
                    AnimatedEmoji("1f512", 96.dp)
                    Text("Войти на новом устройстве?", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                        DeviceRow(DeviceSession(name = i.name, platform = i.platform, ip = i.ip), onEnd = null)
                    }
                    Text(
                        "Подтверждайте, только если этот QR-код показан на вашем устройстве. Ключ переписки уйдёт зашифрованным прямо для него.",
                        textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = {
                            busy = true
                            scope.launch {
                                runCatching { repo.qrApprove(qr!!) }.onSuccess { done = true }.onFailure { error = it.message }
                                busy = false
                            }
                        },
                        enabled = !busy, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(18.dp),
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        else Text("Войти на этом устройстве", fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = { scope.launch { runCatching { repo.qrDecline(qr!!.id) }; onBack() } }, enabled = !busy) { Text("Это не я", color = Danger) }
                }
            }
        }
    }
}

/** QR-код из текста (для входа на этом телефоне). */
@Composable
fun QrImage(text: String, size: Dp, modifier: Modifier = Modifier) {
    val bitmap = remember(text) {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 1))
        val b = Bitmap.createBitmap(m.width, m.height, Bitmap.Config.ARGB_8888)
        for (x in 0 until m.width) for (y in 0 until m.height) b.setPixel(x, y, if (m[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        b.asImageBitmap()
    }
    Box(modifier.background(Color.White, RoundedCornerShape(20.dp)).padding(12.dp)) {
        Image(bitmap, "QR-код для входа", Modifier.size(size), filterQuality = FilterQuality.None)
    }
}

// ======================= Почта и 2FA =======================

/** Почта (для кода при входе) и двухфакторная защита. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityScreen(repo: Repository, onBack: () -> Unit) {
    val me by repo.me.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val user = me ?: return
    val hasEmail = user.email.isNotBlank() && user.verified
    var email by remember(user.email) { mutableStateOf(user.email) }
    var code by remember { mutableStateOf("") }
    var sentTo by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<Pair<String, suspend (String) -> Unit>?>(null) }
    fun toast(t: String) = Toast.makeText(context, t, Toast.LENGTH_SHORT).show()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Почта и 2FA") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            Section("Почта") {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        if (hasEmail) "Привязана: ${user.email}" else "Нужна для подтверждения входа. Почту видите только вы.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        email, { email = it.trim() }, label = { Text("Почта") }, singleLine = true, shape = RoundedCornerShape(16.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth(),
                        leadingIcon = { Icon(Icons.Filled.Email, null) },
                    )
                    OutlinedButton(
                        onClick = {
                            busy = true; error = null
                            scope.launch {
                                runCatching { repo.emailStart(email) }.onSuccess { sentTo = it; toast("Письмо отправлено на $it") }.onFailure { error = it.message }
                                busy = false
                            }
                        },
                        enabled = !busy && email.contains("@"), modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                    ) { Text(if (hasEmail) "Сменить почту" else "Прислать код") }
                    if (sentTo != null) {
                        Text("Код отправлен на $sentTo", style = MaterialTheme.typography.bodyMedium)
                        OutlinedTextField(
                            code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Код из письма") }, singleLine = true,
                            shape = RoundedCornerShape(16.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                busy = true; error = null
                                scope.launch {
                                    runCatching { repo.emailConfirm(code) }.onSuccess { sentTo = null; code = ""; toast("Почта подтверждена") }.onFailure { error = it.message }
                                    busy = false
                                }
                            },
                            enabled = !busy && code.length == 6, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                        ) { Text("Подтвердить") }
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    if (hasEmail) {
                        TextButton(onClick = { ask = "Отвязать почту" to { pw -> repo.emailRemove(pw); toast("Почта отвязана") } }) { Text("Отвязать почту", color = Danger) }
                    }
                }
            }
            Section("Двухфакторная защита") {
                RowItem(
                    Icons.Filled.Shield, "Код из письма при входе",
                    if (hasEmail) "При входе по паролю на новом устройстве попросим ещё код с вашей почты" else "Сначала привяжите почту",
                    trailing = {
                        Switch(user.twoFactor, { on ->
                            ask = (if (on) "Включить подтверждение входа" else "Выключить подтверждение входа") to { pw ->
                                repo.setTwoFactor(on, pw)
                                toast(if (on) "2FA включена: при входе по паролю понадобится код из письма" else "2FA выключена")
                            }
                        }, enabled = hasEmail)
                    },
                )
            }
            Text(
                "Вход по QR-коду с вашего телефона кода не требует: вы подтверждаете его сами.",
                Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.navigationBarsPadding().height(16.dp))
        }
    }
    ask?.let { (title, action) -> PasswordDialog(title, action) { ask = null } }
}

/** Пароль ещё раз — для важных изменений. */
@Composable
private fun PasswordDialog(title: String, action: suspend (String) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var pw by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Подтвердите паролем.")
                OutlinedTextField(
                    pw, { pw = it }, label = { Text("Ваш пароль") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { action(pw) }.onSuccess { onDismiss() }.onFailure { error = it.message }
                    busy = false
                }
            }, enabled = !busy && pw.isNotEmpty()) { Text("Готово") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}
