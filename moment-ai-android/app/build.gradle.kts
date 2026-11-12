plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ai.moment.pleos"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.moment.pleos"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-pre-release"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The existing public MOMENT AI web UI is authoritative: bundle it at build time,
    // don't copy another editable frontend or any WITHU/ChefOS source into the APK.
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/momentAssets"))
}

val syncMomentWeb by tasks.registering(Copy::class) {
    from(file("../../docs/moment-ai"))
    into(layout.buildDirectory.dir("generated/momentAssets/moment"))
    exclude("**/*.map", "**/.DS_Store", "**/.*")
}

tasks.named("preBuild").configure { dependsOn(syncMomentWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
}