# Isolated native-rig diagnostic probe

This independently written Android harness checks a supplied JNI library without
reusing RiggerDroid's Android classes or UI. It requires ARM64 Android API 24+.
The public source contains no native vendor library, vendor models or private
signing material. Those inputs must be supplied separately for a local build.

The JNI class and method descriptors match the declarations observed in the
supplied build. `runSession` takes command, input path, output path, report path,
session path, and a progress callback. Available probe commands are ANALYZE,
INITIAL_BODY_GUIDES and ROUNDTRIP. It does not confirm depth landmarks, build
hands, compute skin weights or claim successful animation quality.

The session uses formatVersion 1 and the observed solver label, reflected-X rig
space, empty landmark/override maps and unconfirmed body/hand flags. Command and
schema compatibility are subject to actual device testing; declarations alone
do not prove successful computation. The native return status is preserved in
the exported report. A returned call is not labelled a successful rig.

A separate app process owns the native calls. The UI has cancellation and a
120-second deadline; native crashes are reported as unconfirmed worker stops.
Imported source files are copied per job and hashed before/after execution.
Native results, environment and file hashes can be saved through Android SAF.
The app requests no Internet, camera, audio or broad storage permission.

## 0.2 input preparation

Actual 0.1 device reports on Android 35 confirmed that the native library loads
and both ANALYZE and INITIAL_BODY_GUIDES return. Both rejected the submitted
model with UNSUPPORTED_GLTF_EXTENSION / KHR_mesh_quantization before solving.
This is evidence of an input-format blocker, not a successful skeleton or weight
test. No device result for 0.2 is claimed by the build checks.

0.2 expands quantized geometry attributes (including morphs and sparse data) to
Float32 before calling the engine. Normalization follows the Khronos extension
equations. Node transforms, inverse binds, texture transforms and the complete
original BIN prefix are preserved. Only geometry accessor references and the
quantization extension declaration change. Draco/Meshopt are explicitly rejected
because this converter is not a decoder for those codecs. Float-only GLBs are
copied byte-for-byte. The original source and the prepared native input have
separate hashes in the receipt; the session hash describes the prepared input.

The same app ID and signing key permit an in-place update. Previously selected
GLBs are restored on startup. Save report filenames include a timestamp.
Run the independent host regression checks using `bash tests/run.sh` (JDK,
Python 3 and curl required; JSON-java is downloaded for host tests only).

Build with a JDK and Android platform/build-tools 35 using `bash build.sh`.
Before alignment/signing, insert the supplied library as a stored ZIP entry at
lib/arm64-v8a/libriggerdroid_rigger.so and provide the two model assets at
assets/probe/donor.glb and assets/probe/demo-human.glb. Preserve applicable engine
license and dependency notices with the private binary package. Neither vendor
binaries nor model data belong in public CI artifacts.
