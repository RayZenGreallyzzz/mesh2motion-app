# Optional motion-aware skin-weight repair

On the animation-selection step, expand **Проверка деформаций**, select one
through eight animation variants, then run **Улучшить веса выбранных движений**.
Mirrored variants count separately. The default autorig, joint fitting and
automatic skinning pipeline are unchanged.

The new pass samples five poses per selected variant on a detached rig copy,
including regenerated joint-volume support tracks. A module worker refines
only the existing positive influences at vertices incident to a severely
stretched edge. Each vertex has a total L1 change budget of 0.5, equivalent to
moving at most 25 percent of its weight mass. Vertices with active manual
overrides are locked, including coincident UV-seam copies. No bone, bone index,
geometry, texture or animation track is replaced.

Every accepted local update lowers total over-stretch energy without increasing
it for any selected clip. Per-clip edge-length extrema remain bounded by the
original samples or a neutral 0.5–2.0 rest-length allowance. A triangle-normal
constraint prevents a new flip or severe area collapse relative to its original
animated pose. The result is published only if aggregate energy decreases and
the number of pose-edge occurrences beyond 2.01 times rest length does not
increase. These guarantees concern the sampled poses, not arbitrary unselected
clips or all times between samples.

The viewport and export read the same geometry attributes. Repeated runs use
the original weights rather than accumulating corrections. **Отменить
исправление** restores those originals. Changing selections, mirror/arm warps,
or model variations invalidates the repair. Pending workers are cancelled when
their context changes. Undo refuses to overwrite a later manual edit or
replaced geometry and reports when a changed part cannot be restored.

The pass requires shared-skeleton material parts with compatible bind spaces.
Independent rigs, active or animated morphs, unsupported hierarchy layouts,
malformed weights and jobs beyond the estimated working-memory budget are
rejected explicitly. Fewer selected clips reduce memory and processing cost.

## Validation of this source revision

- Eleven new automated tests cover measured stretch reduction, input
  immutability, normalization and influence limits, triangle and edge bounds,
  coincident seams, paint locks, detached sampling with a transformed armature,
  inverse-bind fallback, preview/export identity, repeat/Undo, cancellation and
  refusal to overwrite subsequent edits.
- The existing 48 editor regression checks and 18 animal/native-rig checks pass.
- TypeScript checking and the Vite production build pass. The worker is emitted
  as a separate bundled asset.

The previously reviewed private exports and screen recording are no longer
available in this workspace. Results measured on those earlier files are not
claimed as validation of this reconstructed revision. A renewed real-model
check and a full-library signed Android build are pending reattachment of the
two exports and the private backup. No replacement APK is produced by this
source change. There has been no physical Android-device validation.

This does not correct anatomical elbow/knee centers, create missing tail/trunk
bones, perform contact IK, or establish universal compatibility with purchased
animations. It is a reversible deformation refinement for selected movements.
No RigAnything/UniMate weights, purchased assets, user models, signing material
or private library files are included in this branch.
