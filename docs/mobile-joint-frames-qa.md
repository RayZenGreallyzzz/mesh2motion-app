# Mobile humanoid animation and surface fitting (v6.3 test)

Base: `android-rig-animation-studio`, commit `2bb1b8617bc79411cd65cc1d6f69018169c2168d` (v6.1).

The v6.1 local-rest delta does not account for joints moved without rotating their
bone axes. An A-pose fitted by AutoRig still plays T-pose keys in those old axes.
The 87 human-base clips also use a different bind skeleton from rig-human; the
75 addon and 16 mocap clips use the reference skeleton.

The loader now retains the bind transforms from each animation GLB. The bridge
maps each fitted segment into that source's anatomical frame, including the
parent frame, before playback. This handles A/T pose, edited proportions and
local axes without modifying the fitted bind rig or skin weights. Root/pelvis
motion remains relative to the fitted joint placement. Missing constant parent
channels are supplied when a fitted frame requires them.

Conversion happens once on load. Key times, interpolation, duration, and direct
AnimationMixer playback are preserved. Preview and export start with independent
copies of the same corrected keys.

Validation:

- Actual GLBs and GLTFLoader, not synthetic source-rest values.
- All 178 clips, 3 times per clip, both arms and 3 segments each, in 0° and 45°
  fitted poses with arms lengthened 17%: 6,408 direction comparisons. Allowed
  angular error: 0.0001 rad (under 0.006°); limb offsets must remain unchanged.
- The same asset regression fails with the v6.1 converter (first shoulder error
  0.183156 rad, about 10.5°).
- Per-file source provenance, omitted parent tracks, scaled pelvis motion,
  viewport transforms, independent export/preview arrays, unchanged live rig.
- Full suite and production bundle are required by the test APK workflow.

## Surface fitting follow-up

The supplied A-pose elf model and screen recording reproduced two additional
problems after the frame correction: vertex-density estimates placed the torso
in rear hair and pulled the shoulders inward, while globally nearest surface
seeds clustered near narrow limb ends. The untouched T-pose finger subtree also
extended outside the repositioned hand.

AutoRig now uses front/back surface intersections for joint depth and exact
triangle sections for elbow/wrist height. Shoulder spacing uses body height as
its lower bound. The hand subtree follows the visible hand direction and palm
width. Mesh detection supports the source-module Mesh used by the importer.

Skinning seeds cover four longitudinal bins and eight angular sectors for each
bone segment. A narrower distance falloff keeps mid-limb vertices attached to
their own bone; existing local surface smoothing still blends the joints.
These calculations run during fitting/binding, with no added per-frame work.

Validation on the supplied model (75,142 vertices, 121,972 triangles):

- Browser import, floor alignment, AutoRig, binding and loading all 178 clips.
- Bind-pose maximum vertex error: 5.52e-8; no failed meshes.
- Visual inspection of Idle_A, Confused, Bow_Pull_Hold, Sword_Attack, Walk and
  Consume_Item at a fixed point in each clip.
- Mean forearm influence in the sampled mid-forearm region improved from 62.7%
  to 97.3%; unwanted arm influence in the sampled chest fell from about 62% to
  2.3%. These are regional diagnostics, not a whole-model accuracy score.
- Regression cases cover a tapered forearm, smooth elbow blending, rear hair,
  imported Mesh identity, A/T arm sections and hand direction/palm roll.

The supplied model/video are kept outside the repository. Extreme joint bends
may still need manual weight cleanup. Tablet performance and the installed APK
still require an on-device check; browser QA is not a device benchmark.

The test workflow uploads an APK artifact only. It uses a separate Android
application id (`com.rayzen.riganimationstudio.surfacefit`) so older versions stay
installed. It does not commit generated code, merge branches, deploy a website,
or overwrite a release. The existing main Android release workflow is unchanged.

To apply the fix, import the original model again, select Humanoid v6.3, run
AutoRig and bind again before opening animations. Previously exported weights
are not recalculated merely by installing the APK.
