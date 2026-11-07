package ru.beemes.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/* Стиль beemes: медовый жёлтый на глубоком фиолетово-чёрном (или тёплом кремовом в светлой теме). */

val Honey = Color(0xFFFFB627)
val HoneyDeep = Color(0xFFFF8A00)
val Online = Color(0xFF39D98A)
val Danger = Color(0xFFE5383B)

private val DarkScheme = darkColorScheme(
    primary = Honey, onPrimary = Color(0xFF241800),
    primaryContainer = Color(0xFF3A2B05), onPrimaryContainer = Color(0xFFFFDE9E),
    secondary = Color(0xFF9D8CFF), onSecondary = Color(0xFF1A1240),
    background = Color(0xFF15121F), onBackground = Color(0xFFF3EFFF),
    surface = Color(0xFF1C1828), onSurface = Color(0xFFF3EFFF),
    surfaceVariant = Color(0xFF2A2440), onSurfaceVariant = Color(0xFFB4ADC9),
    surfaceContainer = Color(0xFF221D33), surfaceContainerHigh = Color(0xFF2A2440), surfaceContainerHighest = Color(0xFF332C4C),
    surfaceContainerLow = Color(0xFF1C1828), surfaceContainerLowest = Color(0xFF110E19),
    outline = Color(0xFF6E6787), outlineVariant = Color(0xFF3A3352),
    error = Color(0xFFFF6B6E), onError = Color(0xFF3B0003),
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFFE89A00), onPrimary = Color.White,
    primaryContainer = Color(0xFFFFE3A6), onPrimaryContainer = Color(0xFF2B1D00),
    secondary = Color(0xFF6B58E6), onSecondary = Color.White,
    background = Color(0xFFFFF8EA), onBackground = Color(0xFF1B1626),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF1B1626),
    surfaceVariant = Color(0xFFF4EBD8), onSurfaceVariant = Color(0xFF5F5870),
    surfaceContainer = Color(0xFFFBF2E1), surfaceContainerHigh = Color(0xFFF4EBD8), surfaceContainerHighest = Color(0xFFEDE2CB),
    surfaceContainerLow = Color(0xFFFFFBF2), surfaceContainerLowest = Color.White,
    outline = Color(0xFFA59D8C), outlineVariant = Color(0xFFE7DDC8),
    error = Color(0xFFD32F2F), onError = Color.White,
)

private val Type = Typography(
    headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
    titleLarge = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 19.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
)

/** Цвета профиля: каждый выбирает свой — им красится шапка профиля и его «облачка» сообщений. */
enum class Accent(val key: String, val title: String, val start: Color, val end: Color, private val darkText: Color? = null) {
    HONEY("honey", "Мёд", Color(0xFFFFC23D), Color(0xFFFF8A00), Color(0xFF221800)),
    SUNSET("sunset", "Закат", Color(0xFFFF8A5B), Color(0xFFFF3D77)),
    ROSE("rose", "Роза", Color(0xFFFF7AC0), Color(0xFFB84BFF)),
    VIOLET("violet", "Лаванда", Color(0xFFA08CFF), Color(0xFF5B45F0)),
    OCEAN("ocean", "Океан", Color(0xFF4FC3F7), Color(0xFF2F6BFF)),
    MINT("mint", "Мята", Color(0xFF45E0B0), Color(0xFF119C7A), Color(0xFF221800)),
    LIME("lime", "Лайм", Color(0xFFB7EB4A), Color(0xFF3FAE2A), Color(0xFF221800)),
    GRAPHITE("graphite", "Графит", Color(0xFF8E8AA3), Color(0xFF433E57)),
    CHERRY("cherry", "Вишня", Color(0xFFFF6B6B), Color(0xFFC2185B)),
    CORAL("coral", "Коралл", Color(0xFFFFAB91), Color(0xFFFF5E3A)),
    PEACH("peach", "Персик", Color(0xFFFFD3A5), Color(0xFFFD9F6B), Color(0xFF2B1400)),
    LEMON("lemon", "Лимон", Color(0xFFFFF27A), Color(0xFFF5B700), Color(0xFF221800)),
    FOREST("forest", "Лес", Color(0xFF6BCB77), Color(0xFF1E7B3A)),
    TEAL("teal", "Бирюза", Color(0xFF5EE7DF), Color(0xFF0E8C8C), Color(0xFF04282A)),
    SKY("sky", "Небо", Color(0xFFA1C4FD), Color(0xFF4F8DFD), Color(0xFF0B1A33)),
    INDIGO("indigo", "Индиго", Color(0xFF8C9EFF), Color(0xFF3949AB)),
    PLUM("plum", "Слива", Color(0xFFD58CFF), Color(0xFF7B1FA2)),
    BERRY("berry", "Ягоды", Color(0xFFFF6FA8), Color(0xFF9C1458)),
    COCOA("cocoa", "Какао", Color(0xFFC69C7B), Color(0xFF6D4C41)),
    MIDNIGHT("midnight", "Полночь", Color(0xFF6A5ACD), Color(0xFF1A1446));

    val brush: Brush get() = Brush.linearGradient(listOf(start, end))

    /** Текст на этом цвете. */
    val onColor: Color get() = darkText ?: Color.White

    val palette: Palette get() = Palette(key, start, end, onColor)

    companion object {
        /** Сколько цветов было сначала: тем, кто цвет не выбирал, он подбирается из них (чтобы не поменялся). */
        private const val FIRST = 8
        private val CUSTOM = Regex("^g:#([0-9a-fA-F]{6}):#([0-9a-fA-F]{6})$")

        /** Готовый цвет или свой градиент «g:#RRGGBB:#RRGGBB». */
        fun of(key: String): Palette = custom(key) ?: (entries.firstOrNull { it.key == key } ?: HONEY).palette

        /** Если человек не выбрал цвет — подбираем по id (так же, как сайт: |хэш| % 8), чтобы у разных людей были разные. */
        fun forUser(key: String, id: String): Palette =
            custom(key) ?: (entries.firstOrNull { it.key == key } ?: entries[(kotlin.math.abs(id.hashCode().toLong()) % FIRST).toInt()]).palette

        fun custom(key: String): Palette? = CUSTOM.matchEntire(key)?.let { m ->
            val a = Color(0xFF000000 or m.groupValues[1].toLong(16))
            val b = Color(0xFF000000 or m.groupValues[2].toLong(16))
            Palette(key.lowercase(), a, b, if ((a.luminance() + b.luminance()) / 2 > 0.35f) Color(0xFF1B1626) else Color.White)
        }

        fun customKey(a: Color, b: Color) = "g:#%06x:#%06x".format(a.toArgb() and 0xFFFFFF, b.toArgb() and 0xFFFFFF)
    }
}

/** Цвет профиля: два цвета градиента и цвет текста на нём. */
data class Palette(val key: String, val start: Color, val end: Color, val onColor: Color) {
    val brush: Brush get() = Brush.linearGradient(listOf(start, end))
}

val LocalDark = staticCompositionLocalOf { true }

@Composable
fun BeemesTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalDark provides dark) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, typography = Type, content = content)
    }
}
