# Mobile humanoid joint-frame correction (v6.2 test)

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

The original user elf GLB was not attached to the shared conversation, so its
skin weights and on-device appearance are not yet verified. These tests verify
the animation-frame defect; they do not certify every imported model's weights.

The test workflow uploads an APK artifact only. It uses a separate Android
application id (`com.rayzen.riganimationstudio.jointframes`) so v6.1 stays
installed. It does not commit generated code, merge branches, deploy a website,
or overwrite a release. The existing main Android release workflow is unchanged.
