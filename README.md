# Mixamo Bridge — Android offline converter (test)

Standalone, offline-capable Android/WebView app. Source lives under `converter/` on a separate GitHub branch and does not change Rig Animation Studio's main Android release.

**Modes**

* GLB -> OBJ+MTL+embedded base-color PNG textures bundled in a ZIP. This is an official Mixamo-supported character upload format for unrigged meshes.
* GLB -> experimental FBX Binary **7.4 (7400)** with embedded textures, animation clips and skinning via `@comfyorg/fbx-exporter-three` (not FBX 2013; acceptance at Mixamo must be verified).
* FBX -> GLB 2.0 with skeleton, skin weights, embedded texture data where available, and animation clips via Three.js FBXLoader + GLTFExporter.

**Restrictions**

OBJ/MTL loses skeletons, morph target animations and animation clips. Input for Mixamo's autorigger should be a humanoid model in an upright orientation; the format converter does not rig anything by itself. Highly complex Meshy monsters may fail automatic humanoid rigging despite successfully converting. FBX files with external sidecar textures may lose references; embed textures before downloading from Mixamo. Browser runtimes may exhaust memory on 150MB+ assets. The converter neither reduces polygons nor changes skin weights.

**Local web build**

```
npm ci
npx vite build --config converter/vite.config.mjs
```

**Android CI**

Push `feature/mixamo-offline-converter` to trigger `.github/workflows/mixamo-bridge-android.yml`. The APK appears under the run's Artifacts and under a GitHub release tag `mixamo-bridge-v0.1.0` if all checks pass. APK has a separate package ID and is suitable for side-by-side installation with Rig Animation Studio. Android file export uses Storage Access Framework and app-private temporary chunks, requiring no broad storage permissions.

**Testing**

1. GLB from Meshy -> ZIP -> Mixamo upload; confirm that textures and geometry show correctly.
2. FBX download from Mixamo (with skin) -> GLB -> open in Godot. Check number of bones and run/idle animation as well as materials.
3. Optional experimental direct FBX 7400 upload to Mixamo, check actual acceptance before depending on it.

This is a test build, not a certified lossless round trip for all animation and material features.
