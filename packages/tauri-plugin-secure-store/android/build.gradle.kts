plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "app.scratch.securestore"
  compileSdk = 34
  defaultConfig { minSdk = 24 }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.security:security-crypto:1.1.0-alpha06")
  // The Tauri Android plugin scaffolding provides `app.tauri:tauri-android` via
  // the parent project — included transitively when used inside `gen/android`.
}
