# Editable initial limb pose

After binding a classic creature rig, use «Настроить исходную позу рук и ног»
on the weight step or «Исходная поза рук и ног» in the animation step.
Already rigged GLBs have the same editor under «Риг» in the room viewer.

Choose a bone, rotate it on local X/Y/Z axes, and optionally change its local
joint offset. «Опустить лапу на пол» uses a short CCD chain toward the visible
model's ground height. Inspect the joint angles before saving: this helper has
no species-specific anatomical limits and is not a gait/contact solver.
«Отмена» discards the current edits; «Сбросить правки позы» resets the editor's
current calibration. The mixer is stopped while the editor is open.

The calibration is a parent-local quaternion offset and position delta applied
to every animation key. The default exported node pose is updated too. Skin
weights, geometry and inverse bind matrices are preserved. Existing rest/bind
snapshots are restored before classic weight/bind processing resumes. The
classic export clone applies the calibrated pose after restoring the original
snapshot; mirrored motions receive the target rig's correction after mirroring.
Cubic quaternion tangents are transformed without normalization and translation
tangents retain their original values.

The room viewer's GLB writer updates explicit pose node overrides and appends
new animation data while retaining the original binary prefix. Corrections
therefore survive export, reload, and saving to the device library. Each new
editing session in that viewer is relative to the saved asset pose.

Validation:

- TypeScript, 20 focused unit tests, web and Android builds.
- Browser tests for room/popup/portrait behavior and native failure recovery
  using a mock native bridge, plus pose editing and Android export transport.
- Browser test of the classic animation-listing editor: a paused mixer during
  editing, repeated clip switching, calibrated export copy, and restoration of
  the original bind pose on exit with unchanged inverse bind matrices.
- `scripts/pose-check.ts` builds an offline Node diagnostic that can read a
  private GLB locally, lower one foot, export/reload all its motions, sample
  bone/skin results and compare the original binary prefix and skin declarations.
  User models are not embedded in CI or the diagnostic bundle.

This is reference-pose correction. It does not rebuild a species skeleton,
repair weights, or promise correct elbows/knees for every rig. Native ARM64
end-to-end rig quality still requires testing on an Android device.
