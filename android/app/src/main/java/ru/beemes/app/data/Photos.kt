package ru.beemes.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream

/** Подготовка фото к отправке: уменьшить до 1600 px, повернуть как надо, сжать и сделать крошечное превью. */
object Photos {
    class Prepared(val jpeg: ByteArray, val width: Int, val height: Int, val preview: String)

    fun prepare(context: Context, uri: Uri, maxSide: Int = 1600): Prepared {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        var bitmap = resolver.openInputStream(uri)!!.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw ApiException("Не получилось открыть фото")
        val rotation = runCatching {
            resolver.openInputStream(uri)!!.use { ExifInterface(it).rotationDegrees }
        }.getOrDefault(0)
        if (rotation != 0) bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
        val scale = maxSide.toFloat() / maxOf(bitmap.width, bitmap.height)
        if (scale < 1f) bitmap = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        return fromBitmap(bitmap)
    }

    fun fromBitmap(bitmap: Bitmap, quality: Int = 85): Prepared {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        val tiny = Bitmap.createScaledBitmap(bitmap, 24, (24f * bitmap.height / bitmap.width).toInt().coerceIn(8, 48), true)
        val tinyOut = ByteArrayOutputStream()
        tiny.compress(Bitmap.CompressFormat.JPEG, 40, tinyOut)
        return Prepared(out.toByteArray(), bitmap.width, bitmap.height, Crypto.b64(tinyOut.toByteArray()))
    }

    /** Квадратный аватар 512×512. */
    fun avatar(context: Context, uri: Uri): ByteArray {
        val p = prepare(context, uri, 1024)
        val full = BitmapFactory.decodeByteArray(p.jpeg, 0, p.jpeg.size)
        val side = minOf(full.width, full.height)
        val square = Bitmap.createBitmap(full, (full.width - side) / 2, (full.height - side) / 2, side, side)
        val scaled = Bitmap.createScaledBitmap(square, 512, 512, true)
        return ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 88, it) }.toByteArray()
    }
}
