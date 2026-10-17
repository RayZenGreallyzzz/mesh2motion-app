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
# File I/O tests do not need a 1080p software-rendered canvas.
adb shell wm size 480x800
# Test APKs were compiled before booting the emulator to avoid competing for RAM.
(cd android && ./gradlew :app:connectedDebugAndroidTest --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m)
