#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "$0")" && pwd)"
probe_build="$probe_dir/build"
probe_tools="$ANDROID_HOME/build-tools/35.0.0"
probe_platform="$ANDROID_HOME/platforms/android-35/android.jar"
mkdir -p "$probe_build/classes" "$probe_build/dex"
mapfile -t probe_sources < <(find "$probe_dir/src" -type f -name '*.java')
javac -encoding UTF-8 --release 8 -classpath "$probe_platform" -d "$probe_build/classes" "${probe_sources[@]}"
mapfile -t probe_classes < <(find "$probe_build/classes" -type f -name '*.class')
"$probe_tools/d8" --lib "$probe_platform" --min-api 24 --output "$probe_build/dex" "${probe_classes[@]}"
"$probe_tools/aapt" package -f -M "$probe_dir/AndroidManifest.xml" -I "$probe_platform" -F "$probe_build/Rig-Engine-Probe-unsigned.apk"
python3 - "$probe_build" <<'PY'
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1])
with zipfile.ZipFile(p/'Rig-Engine-Probe-unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(p/'dex/classes.dex','classes.dex')
PY
