#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "$0")/.." && pwd)"
probe_test_build="$probe_dir/build/jvm"
mkdir -p "$probe_test_build/classes"
curl --fail --silent --show-error --location --retry 2 https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar -o "$probe_test_build/json.jar"
javac --release 8 -encoding UTF-8 -cp "$probe_test_build/json.jar" -d "$probe_test_build/classes" "$probe_dir/src/com/rayzen/rigprobe/GlbQuantization.java" "$probe_dir/src/com/rayzen/rigprobe/GlbWebpCompatibility.java" "$probe_dir/tests/GlbPrepareCli.java" "$probe_dir/tests/GlbWebpCli.java"
python3 "$probe_dir/tests/verify_quantization.py" java -cp "$probe_test_build/classes:$probe_test_build/json.jar" GlbPrepareCli | tee "$probe_dir/build/quantization-test-results.json"
python3 -m venv "$probe_test_build/python"
"$probe_test_build/python/bin/python" -m pip --disable-pip-version-check install --quiet Pillow==11.0.0
"$probe_test_build/python/bin/python" "$probe_dir/tests/verify_webp.py" java -cp "$probe_test_build/classes:$probe_test_build/json.jar" GlbWebpCli | tee "$probe_dir/build/webp-test-results.json"

