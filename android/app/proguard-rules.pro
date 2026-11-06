# kotlinx.serialization: сохраняем классы данных, которые читаются из JSON.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers @kotlinx.serialization.Serializable class ** { *** Companion; *; }
-keep,includedescriptorclasses class ru.beemes.app.**$$serializer { *; }
-keepclassmembers class ru.beemes.app.** { *** Companion; }
-keepclasseswithmembers class ru.beemes.app.** { kotlinx.serialization.KSerializer serializer(...); }
# Мост страницы звонка (WebView → приложение).
-keepclassmembers class ru.beemes.app.call.CallActivity$Bridge { @android.webkit.JavascriptInterface <methods>; }
# Tink: необязательные зависимости.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
