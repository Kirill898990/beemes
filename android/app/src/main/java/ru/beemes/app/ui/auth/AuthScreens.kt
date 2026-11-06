package ru.beemes.app.ui.auth

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.beemes.app.data.ApiException
import ru.beemes.app.data.Repository
import ru.beemes.app.ui.components.AnimatedEmoji
import ru.beemes.app.ui.components.EmojiIcon
import ru.beemes.app.ui.components.Honeycomb
import ru.beemes.app.ui.openUrl
import ru.beemes.app.ui.theme.Honey

@Composable
private fun AuthBackground(content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.colorScheme.background)),
        ),
    ) {
        Honeycomb(Modifier.fillMaxSize(), MaterialTheme.colorScheme.primary.copy(alpha = 0.07f))
        content()
    }
}

@Composable
fun WelcomeScreen(onRegister: () -> Unit, onLogin: () -> Unit) {
    AuthBackground {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            AnimatedEmoji("1f41d", 170.dp)
            Spacer(Modifier.height(8.dp))
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = MaterialTheme.colorScheme.onBackground)) { append("bee") }
                    withStyle(SpanStyle(color = Honey)) { append("mes") }
                },
                fontSize = 52.sp, fontWeight = FontWeight.Black, letterSpacing = (-1.5).sp,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Мессенджер, в котором переписка видна только вам и собеседнику",
                style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(28.dp))
            Feature("🔒", "Сквозное шифрование", "Сообщения и фото шифруются на телефоне. Даже сервер их не прочитает.")
            Feature("😍", "Живые эмодзи", "Сотни анимированных эмодзи — бесплатно и для всех.")
            Feature("📞", "Звонки и видео", "Звоните голосом и по видео прямо из чата.")
            Spacer(Modifier.weight(1f))
            Button(
                onClick = onRegister, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp),
            ) { Text("Создать аккаунт", fontSize = 17.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(10.dp))
            OutlinedButton(onClick = onLogin, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(18.dp)) {
                Text("У меня уже есть аккаунт", fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun Feature(emoji: String, title: String, text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(46.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
            EmojiIcon(emoji, 32.dp)
        }
        Column(Modifier.padding(start = 14.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AuthTop(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") }
        Text(title, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun Field(
    value: String, onChange: (String) -> Unit, label: String, error: String? = null, supporting: String? = null,
    password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, prefix: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    var show by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        isError = error != null,
        prefix = prefix?.let { { Text(it) } },
        supportingText = (error ?: supporting)?.let { { Text(it) } },
        visualTransformation = if (password && !show) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard, imeAction = ImeAction.Next),
        trailingIcon = trailing ?: if (password) { { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, "Показать пароль") } } } else null,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun RegisterScreen(repo: Repository, onBack: () -> Unit, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var password2 by rememberSaveable { mutableStateOf("") }
    var consent by rememberSaveable { mutableStateOf(false) }
    var free by remember { mutableStateOf<Boolean?>(null) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(username) {
        free = null
        val u = username.trim().lowercase()
        if (Regex("^[a-z0-9_]{3,32}$").matches(u)) {
            delay(400)
            free = runCatching { repo.usernameFree(u).free }.getOrNull()
        }
    }

    fun submit() {
        val e = buildMap {
            if (name.isBlank()) put("name", "Впишите имя")
            if (!Regex("^[a-z0-9_]{3,32}$").matches(username.trim().lowercase())) put("username", "От 3 до 32: латинские буквы, цифры и _")
            else if (free == false) put("username", "Это @имя уже занято")
            if (password.length < 8) put("password", "Не меньше 8 символов")
            if (password2 != password) put("password2", "Пароли не совпадают")
            if (!consent) put("consent", "Нужно согласие с политикой конфиденциальности")
        }
        errors = e
        if (e.isNotEmpty()) return
        busy = true
        message = null
        scope.launch {
            try {
                repo.register(name, username, password)
                onDone()
            } catch (ex: ApiException) {
                errors = ex.fields.mapKeys { if (it.key == "passwordConfirm") "password2" else it.key }
                message = ex.message
            } catch (ex: Exception) {
                message = ex.message ?: "Не получилось"
            }
            busy = false
        }
    }

    AuthBackground {
        Column(Modifier.fillMaxSize().imePadding()) {
            AuthTop("Новый аккаунт", onBack)
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Field(name, { name = it.take(64) }, "Имя", errors["name"], "Так вас увидят собеседники")
                Field(
                    username, { username = it.lowercase().replace(" ", "").removePrefix("@").take(32) }, "@имя", errors["username"],
                    when (free) { true -> "✓ Свободно"; false -> "Занято"; else -> "По нему вас найдут: латинские буквы, цифры и _" },
                    prefix = "@",
                )
                Field(password, { password = it }, "Пароль", errors["password"], "Не меньше 8 символов", password = true)
                Field(password2, { password2 = it }, "Повторите пароль", errors["password2"], password = true)
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Row(Modifier.padding(14.dp)) {
                        Text("🔐", fontSize = 22.sp)
                        Text(
                            "Запомните пароль. Он защищает ключ шифрования вашей переписки: без пароля восстановить сообщения нельзя — даже нам.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(start = 10.dp),
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { consent = !consent }) {
                    Checkbox(checked = consent, onCheckedChange = { consent = it })
                    Text(
                        buildAnnotatedString {
                            append("Я соглашаюсь с ")
                            withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)) { append("политикой конфиденциальности") }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.clickable { context.openUrl(repo.siteUrl + "/privacy.html") },
                    )
                }
                errors["consent"]?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                Spacer(Modifier.height(4.dp))
                Button(
                    onClick = ::submit, enabled = !busy, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Text("  Создаём ключи шифрования…")
                    } else Text("Создать аккаунт", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
fun LoginScreen(repo: Repository, onBack: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    AuthBackground {
        Column(Modifier.fillMaxSize().imePadding()) {
            AuthTop("Вход", onBack)
            Column(Modifier.fillMaxSize().navigationBarsPadding().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { AnimatedEmoji("1f41d", 96.dp) }
                Field(username, { username = it.lowercase().trim().removePrefix("@") }, "@имя", prefix = "@")
                Field(password, { password = it }, "Пароль", password = true)
                Text(
                    "На новом телефоне переписка восстановится: ключ шифрования откроется вашим паролем.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(
                    onClick = {
                        busy = true; message = null
                        scope.launch {
                            try { repo.login(username, password); onDone() } catch (e: Exception) { message = e.message ?: "Не получилось войти" }
                            busy = false
                        }
                    },
                    enabled = !busy && username.length >= 3 && password.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp),
                    colors = ButtonDefaults.buttonColors(),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Войти", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
