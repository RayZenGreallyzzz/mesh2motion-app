# Mesh2Motion Android

This is an **offline WebView shell** for the existing Three.js/Vite editor. It
uses `WebViewAssetLoader` rather than `file://` URLs, so ES modules, GLB models,
and bundled animations load in a single secure origin.

The app uses Android's native document picker for importing models. Exported
GLB and FBX files are streamed from JS to a temporary app file in 24 KiB
chunks, then saved through Android's document picker. No broad storage
permission is required.

## Download an APK

Go to **GitHub → Actions → Mesh2Motion Android APK → latest successful run →
Artifacts → Mesh2Motion-Android-debug-APK**. Unzip and install the debug APK
on an Android 8.0+ device. Debug builds are for testing only.

## Build

At the repository root: `npm ci && npm run build`, then copy all `dist/`
files into `android/app/src/main/assets/`. With JDK 17, Android SDK 35,
and Gradle 8.11.1 installed, run `gradle :app:assembleDebug` in `android/`.

When changing the web app, rebuild the assets before rebuilding the APK.

## Current limitations

A native APK is **not Blender running on Android**: skeleton generation and
animation export still happen in the embedded WebView with Three.js. Automatic
weight assignment on complex layered meshes may need manual adjustment.
High-poly models and long animation sets consume device memory.
