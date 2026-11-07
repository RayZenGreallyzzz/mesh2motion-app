# Native engine inside Rig Animation Studio

Branch: `feature/native-rigger-studio-2026-11-07`, based on Studio 8.1.7
(`058c4a10ffcff2309696f6789b2bf4e1fe86e3e8`).

The existing Studio character viewer now has a humanoid native-rig panel. The
entry in the model-loading screen opens the same viewer with the built-in human
model already visible. Users can open their own embedded GLB instead. Native
results enter the existing rig viewer, skeleton toggle, motion library, retarget
and GLB export paths. Existing rig/animation catalogs are not rewritten.

## Actual execution path

1. Stream the GLB into an app-private project with ordered bounded chunks.
2. In an isolated Android process, expand KHR_mesh_quantization attributes and
   replace EXT_texture_webp images with embedded full-size PNGs. Keep the source.
3. Run INITIAL_BODY_GUIDES and show the engine's returned points on the model.
4. Run PROPOSE_BODY with the reviewed guide map; show editable landmark points.
5. Run PREVIEW_BODY and draw the returned bone links over the original model.
6. Require front and side review and an explicit confirmation before passing
   depthConfirmed to BUILD_SKELETON. Editing points invalidates confirmation.
7. Run COMPUTE_WEIGHTS and EXPORT. Accept an output only after the engine reports
   DONE and the GLB loads with finite, normalized weights and valid bone indices.
8. Open the resulting skinned model in Studio and use its existing animation UI.

Native calls and image preparation run in a private `:nativeRig` process; native
errors/crashes keep the WebView and original character visible. A 120-second
deadline and cancellation stop only the app's worker PID. IPC carries paths and
progress, not complete model buffers. The plugin exposes UUID project IDs and a
fixed file/command allowlist. The JNI class/instance method signatures and engine
SHA match the supplied module.

The module uses reflected-X rig space, while the viewer uses glTF coordinates.
Marker display/dragging applies that reflection at the boundary and preserves
the original node transforms. The APK is a separate Android package
`com.rayzen.riganimationstudio.nativetest` for testing alongside the installed app.

## Scope and evidence

This native module builds a humanoid body. Studio's existing animal/creature
workflows stay available. Hand features are not enabled by this integration.
Point/bone reports are parsed strictly; unexpected contracts stop with a report,
rather than substituting fabricated coordinates or accepting an empty rig.

Host tests cover transport, malformed reports, output skin validation and format
conversion. The browser check uses an explicitly mocked native bridge to verify
a visible character, marker/skeleton review, failure preservation and playback of
a loaded skinned GLB. These checks do not execute the ARM64 engine. The supplied
device reports establish that the library loads; they only reached input-format
validation. End-to-end native skeleton/weight quality still needs device testing.

## Build and private inputs

The public workflow compiles the Studio web app and Android bridge. It contains
no vendor binary or private signing keys. After `cap sync`, apply the existing
branding/export installers, then `scripts/install-native-rig-plugin.mjs`.
Use `tools/assemble-native-studio.py` with the compiled shell and the owner's
supplied Probe APK, then align and sign the result privately. Preserve the engine
license notices. The assembly tool verifies the native SHA and retains every
existing `assets/public/` byte from the shell.

Privately restored animation packs are separate from the public repository
assets. A shell build does not establish that missing private packs were
restored. Native integration does not remove catalog entries or model files.
