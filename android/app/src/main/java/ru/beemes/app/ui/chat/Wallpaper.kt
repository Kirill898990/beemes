package ru.beemes.app.ui.chat

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ru.beemes.app.data.Repository
import ru.beemes.app.ui.components.Honeycomb

/** Готовые фоны чата — те же, что на сайте (server/pb_public/web/js/ui.js → WALLPAPERS). */
data class Wallpaper(val id: String, val name: String, val a: Color, val b: Color)

val WALLPAPERS = listOf(
    Wallpaper("sunset", "Закат", Color(0xFFFFB25B), Color(0xFFFF5E8A)),
    Wallpaper("ocean", "Океан", Color(0xFF3D8BFF), Color(0xFF36D1C4)),
    Wallpaper("mint", "Мята", Color(0xFF9BEFC8), Color(0xFF2BB673)),
    Wallpaper("lavender", "Лаванда", Color(0xFFC7B6FF), Color(0xFF7D5CFF)),
    Wallpaper("sakura", "Сакура", Color(0xFFFFD0E2), Color(0xFFFF7EB3)),
    Wallpaper("sky", "Небо", Color(0xFFCDEBFF), Color(0xFF7FB2FF)),
    Wallpaper("peach", "Персик", Color(0xFFFFE0C2), Color(0xFFFF9F7A)),
    Wallpaper("sand", "Песок", Color(0xFFFBEBC4), Color(0xFFE6BC6E)),
    Wallpaper("forest", "Лес", Color(0xFF3E7D5C), Color(0xFF163828)),
    Wallpaper("night", "Ночь", Color(0xFF352B5A), Color(0xFF0E0B19)),
    Wallpaper("berry", "Ягоды", Color(0xFF8E2D6B), Color(0xFF2A0E2F)),
    Wallpaper("graphite", "Графит", Color(0xFF55555F), Color(0xFF1C1C22)),
)

fun presetOf(value: String): Wallpaper? = WALLPAPERS.firstOrNull { "p:${it.id}" == value }

@Composable
private fun PresetBackground(w: Wallpaper, modifier: Modifier = Modifier) {
    Box(modifier.background(Brush.verticalGradient(listOf(w.a, w.b)))) {
        Honeycomb(Modifier.fillMaxSize(), Color.White.copy(alpha = 0.16f))
    }
}

/** Фон переписки: соты, готовый фон или своё фото. */
@Composable
fun ChatWallpaper(repo: Repository, chatId: String, value: String, modifier: Modifier = Modifier) {
    val preset = presetOf(value)
    when {
        value.startsWith("photo:") -> {
            var bitmap by remember(value) { mutableStateOf<Bitmap?>(null) }
            LaunchedEffect(value) { bitmap = runCatching { withContext(Dispatchers.IO) { repo.wallpaperPhoto(chatId) } }.getOrNull() }
            val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
            Box(modifier) {
                val b = bitmap
                if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                else Honeycomb(Modifier.fillMaxSize())
                if (dark) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.18f)))
            }
        }
        preset != null -> PresetBackground(preset, modifier)
        else -> Honeycomb(modifier)
    }
}

/** Выбор фона: «Соты», 12 готовых и своё фото. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WallpaperSheet(current: String, onPick: (String) -> Unit, onPhoto: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Фон чата", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "Фон этого чата видите только вы. Своё фото шифруется, как фото в переписке.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )
            LazyVerticalGrid(
                columns = GridCells.Adaptive(96.dp), modifier = Modifier.heightIn(max = 560.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item { Tile("Соты", current == "", { onPick("") }) { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) { Honeycomb(Modifier.fillMaxSize(), MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)) } } }
                items(WALLPAPERS, key = { it.id }) { w -> Tile(w.name, current == "p:${w.id}", { onPick("p:${w.id}") }) { PresetBackground(w, Modifier.fillMaxSize()) } }
                item {
                    Tile("Своё фото", current.startsWith("photo:"), onPhoto, light = true) {
                        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.Image, null, Modifier.size(30.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(label: String, selected: Boolean, onClick: () -> Unit, light: Boolean = false, background: @Composable () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        Modifier.fillMaxWidth().aspectRatio(0.75f).clip(shape)
            .border(if (selected) BorderStroke(3.dp, MaterialTheme.colorScheme.primary) else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), shape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; this.selected = selected },
    ) {
        background()
        Text(
            label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            color = if (light) MaterialTheme.colorScheme.onSurface else Color.White,
            modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp)
                .background(if (light) Color.Transparent else Color(0x80141020), RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 2.dp),
        )
        if (selected) {
            Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(22.dp).background(MaterialTheme.colorScheme.primary, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Check, null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onPrimary)
            }
        }
    }
}
