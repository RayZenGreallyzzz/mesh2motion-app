# Restore the private animation library

The current application catalog contains 63 Phoenix packs: two UAL2 variants
and 61 animal/monster rigs. Catalog entries alone are not assets. The full build
must contain all 63 GLBs, their native skeletons, embedded textures and 742
clips including the two versions of each of the 43 UAL2 actions. The 61
creature rigs contain 656 actions in total.

User asset archives, converted GLBs, complete APKs containing those assets and
signing keys must stay out of this public repository. The source archive is a
local input, not a public download dependency.

With Blender 3.6 installed, restore the full source archive locally:

```sh
python3 scripts/restore-phoenix-library.py --archive /path/to/Phoenix_Rigs_Animations_ALL.zip --blender /path/to/blender
npm run test:library
npm run build:library
```

The importer extracts only local source assets, disables Blender script
execution, exports every action with all source bones, and verifies the entire
staged catalog before replacing the current pack directory. UAL2 GLBs are
copied unchanged. The existing Mesh2Motion models, rigs and animations are
not replaced. Blender reference reports live in checks, outside the web build.

The full-library build fails if a catalog file is missing, an animation or bone
count changes, a clip is empty or a buffer/texture requires an external file.
The private library tests open every GLB using the application asset code,
prepare every pack skeleton, exercise every native clip and compare rendered
surface bounds at authored frame times against Blender. Isolated editing
vertices without polygons are excluded from that comparison; GLB uses baked
linear animation interpolation between frames. These numerical checks do not
replace visual testing on the target Android device.

The editor and the standard Blender GLB export use four influences per vertex.
For a like-for-like comparison, the Blender reference uses that same limit;
each conversion report records the number of affected vertices and largest
discarded influence fraction. Original .blend files are never overwritten.

For the v8.1.6 native shell, scripts/repack-private-library.py can replace the
web assets of the verified v8.1.4 APK with the validated local dist directory.
The resulting APK is unsigned; align and sign it with the locally retained
test key, then verify both the signature and all catalog entries in the final
APK. This test package keeps com.rayzen.riganimationstudio.v815test, uses version
code 816/name 8.1.6 and must be signed with the private v8.1.5 test key. It updates
v8.1.5 while retaining that package's local imports and settings. Do not uninstall
v8.1.5 before installing the update. Other test packages remain separate.
