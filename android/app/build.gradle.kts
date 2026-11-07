import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Уведомления Firebase: файл google-services.json кладётся в папку app (его нет в Git, см. README).
// Без него приложение тоже собирается и работает, просто без push-уведомлений.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// ===== АДРЕС СЕРВЕРА =====
// Адрес сервера beemes. kbast.ru тоже работает — для старых версий приложения.
val releaseServerUrl = "https://beemes.ru"
// Для проверки с сервером на своём компьютере: в local.properties строка server.url=http://10.0.2.2:8091
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val debugServerUrl = localProperties.getProperty("server.url") ?: releaseServerUrl
// Сайт «Простая химия» — для учебного профиля с оценками (для проверки: school.url в local.properties).
val releaseSchoolUrl = "https://xn--h1aaafbiaikhnfkx.xn--p1ai"
val debugSchoolUrl = localProperties.getProperty("school.url") ?: releaseSchoolUrl

// Подпись release-сборки — из keystore.properties (его нет в Git).
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply {
    if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) }
}

android {
    namespace = "ru.beemes.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.beemes.app"
        minSdk = 26
        targetSdk = 36
        // Перед каждой новой версией увеличивайте versionCode на 1.
        versionCode = 3
        versionName = "1.2"
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "SERVER_URL", "\"$debugServerUrl\"")
            buildConfigField("String", "SCHOOL_URL", "\"$debugSchoolUrl\"")
        }
        release {
            buildConfigField("String", "SERVER_URL", "\"$releaseServerUrl\"")
            buildConfigField("String", "SCHOOL_URL", "\"$releaseSchoolUrl\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.exifinterface)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.tink)
    implementation(libs.lottie.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
}
