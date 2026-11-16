# Chest weights and animation-only GLB (8.2.5)

The automatic humanoid surface field could leave pectoral vertices weighted to
clavicles and upper arms. The waist guard excluded clavicles and was not a
complete anterior chest guard. Moving an arm could pull the pectoral surface.

The human/woman automatic field now removes arm-branch leakage in a surface-fitted
anterior chest region, with smooth boundaries and capsules that retain arm
movement. Existing torso influences are retained. This runs before manual
painting; imported rigs are not silently rewritten.

An owner-supplied 365,147-vertex, 65-joint GLB was repaired separately using the
same guard: 7,105 vertices changed, 350,141 vertices were outside the mask and
retained their values. In the protected core, mean arm influence went from
0.050096 to less than 1e-9. At 30/60/100-degree arm/shoulder probes, mean unwanted
core displacement went from 0.0050/0.0096/0.0141 model units to less than 2.4e-8.
Far-arm displacement differed by less than 8e-9. Geometry, textures, hierarchy,
inverse bind data and the original binary prefix were preserved. One transferred
Melee_Hook clip was exported/reopened and 1,825,735 vertex-frames were finite.
These measurements cover this region and these poses, not every shoulder crease.

The supplied character had no animation clips. Its automatic mapping to the
stock human base and mocap packs succeeded (all 65 target joints). The exact
animation producing the user's manual-mapping prompt has not been identified.

A separate reproducible import failure was found for animation-only GLBs that
omit `skins`. glTF has no independent bone node type, so they previously yielded
zero source joints. A connected, uniquely named humanoid hierarchy with pelvis,
spine/head, both complete arms and both complete legs can now be recognized when
its transforms or ancestors are animated. Ambiguous/disconnected/ordinary scene
animations remain uninferred. The source is labelled as inferred in the mapping
dialog and can be previewed before adding clips. No target weights are changed
by animation transfer. The dialog now explains that mapping is automatic.

Validation: 69 focused tests, TypeScript and production web build. Android device
execution and the proprietary native rigger are not covered by these checks.
`scripts/check-chest-local.ts` is an offline owner-asset diagnostic/export tool;
it does not upload the input or include the asset in the repository.
