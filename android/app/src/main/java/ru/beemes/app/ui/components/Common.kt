package ru.beemes.app.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.LottieConstants
import com.airbnb.lottie.compose.rememberLottieComposition
import ru.beemes.app.BeemesApp
import ru.beemes.app.data.Emoji
import ru.beemes.app.data.User
import ru.beemes.app.ui.theme.Accent
import kotlin.math.cos
import kotlin.math.sin

/** Шестиугольник со скруглёнными углами — соты, фирменная форма аватаров beemes. */
object HexShape : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val path = Path()
        val r = minOf(size.width, size.height) / 2f
        val cx = size.width / 2f
        val cy = size.height / 2f
        val corner = r * 0.18f
        val pts = (0 until 6).map { i ->
            val a = Math.toRadians(60.0 * i - 90.0)
            Offset(cx + r * cos(a).toFloat(), cy + r * sin(a).toFloat())
        }
        for (i in 0 until 6) {
            val p = pts[i]
            val prev = pts[(i + 5) % 6]
            val next = pts[(i + 1) % 6]
            val a = p + (prev - p) * (corner / r)
            val b = p + (next - p) * (corner / r)
            if (i == 0) path.moveTo(a.x, a.y) else path.lineTo(a.x, a.y)
            path.quadraticTo(p.x, p.y, b.x, b.y)
        }
        path.close()
        return Outline.Generic(path)
    }
}

/** Аватар: фото или первая буква имени на цвете профиля. */
@Composable
fun Avatar(user: User, size: Dp = 52.dp, modifier: Modifier = Modifier) {
    val repo = BeemesApp.repo
    val thumb = if (size > 100.dp) "480x480" else "160x160"
    var bitmap by remember(user.id, user.avatar) { mutableStateOf<Bitmap?>(repo?.cachedAvatar(user, thumb)) }
    LaunchedEffect(user.id, user.avatar) {
        if (bitmap == null && user.avatar.isNotBlank()) bitmap = repo?.avatar(user, thumb)
    }
    val accent = Accent.forUser(user.accent, user.id)
    Box(modifier.size(size).clip(HexShape).background(accent.brush), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b != null) {
            Image(b.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Text(
                user.title.trim().removePrefix("@").take(1).uppercase().ifBlank { "🐝" },
                color = accent.onColor, fontSize = (size.value * 0.4f).sp, fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** Анимированный эмодзи (Lottie из набора Noto). */
@Composable
fun AnimatedEmoji(code: String, size: Dp, modifier: Modifier = Modifier, play: Boolean = true) {
    val composition by rememberLottieComposition(LottieCompositionSpec.Asset(Emoji.asset(code)))
    LottieAnimation(
        composition,
        iterations = if (play) LottieConstants.IterateForever else 1,
        isPlaying = play,
        modifier = modifier.size(size),
    )
}

/** Текст, в котором эмодзи из набора — анимированные. */
@Composable
fun EmojiText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    color: Color = Color.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
    emojiSize: TextUnit = 1.25.em,
) {
    val parts = remember(text) { Emoji.split(text) }
    if (parts.none { it is Emoji.Part.Animated }) {
        Text(text, modifier = modifier, style = style, color = color, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
        return
    }
    val inline = mutableMapOf<String, InlineTextContent>()
    val annotated = buildAnnotatedString {
        parts.forEachIndexed { i, p ->
            when (p) {
                is Emoji.Part.Text -> append(p.text)
                is Emoji.Part.Animated -> {
                    val id = "e$i"
                    appendInlineContent(id, p.emoji)
                    inline[id] = InlineTextContent(Placeholder(emojiSize, emojiSize, PlaceholderVerticalAlign.TextCenter)) {
                        val px = with(LocalDensity.current) { (style.fontSize.takeIf { it.isSp } ?: 16.sp).toDp() }
                        AnimatedEmoji(p.code, px * emojiSize.value)
                    }
                }
            }
        }
    }
    Text(annotated, modifier = modifier, style = style, color = color, inlineContent = inline, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** Фон чатов: еле заметные соты. */
@Composable
fun Honeycomb(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.035f)) {
    Canvas(modifier) {
        val r = 22.dp.toPx()
        val w = r * 1.732f
        val stroke = Stroke(1.dp.toPx())
        var row = 0
        var y = 0f
        while (y < size.height + r) {
            var x = if (row % 2 == 0) 0f else w / 2
            while (x < size.width + w) {
                val path = Path()
                for (i in 0 until 6) {
                    val a = Math.toRadians(60.0 * i - 90.0)
                    val px = x + r * cos(a).toFloat()
                    val py = y + r * sin(a).toFloat()
                    if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                }
                path.close()
                drawPath(path, color, style = stroke)
                x += w
            }
            y += r * 1.5f
            row++
        }
    }
}

/** Имя со статус-эмодзи (анимированным) справа. */
@Composable
fun NameWithStatus(user: User, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified, emojiSize: Dp = 20.dp) {
    androidx.compose.foundation.layout.Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(user.title, style = style, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Emoji.statusCode(user.statusEmoji)?.let { code ->
            androidx.compose.foundation.layout.Spacer(Modifier.size(4.dp))
            AnimatedEmoji(code, emojiSize)
        }
    }
}

/** Эмодзи: анимированный, если есть в наборе, иначе обычный. */
@Composable
fun EmojiIcon(emoji: String, size: Dp, modifier: Modifier = Modifier) {
    val code = remember(emoji) { Emoji.codeOf(emoji) }
    if (code != null) AnimatedEmoji(code, size, modifier)
    else Text(emoji, fontSize = (size.value * 0.78f).sp, modifier = modifier)
}
