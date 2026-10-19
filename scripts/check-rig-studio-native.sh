#!/usr/bin/env bash
set -euo pipefail
mkdir -p artifacts
# Save diagnostics even if the emulator disappears. Never convert a test failure to success.
collect_diagnostics() {
  local rig_test_status=$?
  timeout 10s adb logcat -d > artifacts/android-logcat.txt 2>&1 || true
  { free -m; sudo dmesg | tail -100; } > artifacts/android-host.txt 2>&1 || true
  exit "$rig_test_status"
}
trap collect_diagnostics EXIT
# The fresh emulator can still be behind keyguard when ActivityScenario starts.
# Native document intents require an awake, focused activity.
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell svc power stayon true
adb shell settings put system screen_off_timeout 600000
# File I/O tests do not need a 1080p software-rendered canvas.
adb shell wm size 480x800
# A fresh installation must work without ever connecting to the internet.
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
# Test APKs were compiled before booting the emulator to avoid competing for RAM.
(cd android && ./gradlew :app:connectedDebugAndroidTest --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m)
