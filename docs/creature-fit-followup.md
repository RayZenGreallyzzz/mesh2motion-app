# Creature fitting follow-up

The previous library restoration verified native packs and clips. It did not
establish correct automatic rigging of arbitrary replacement meshes.

This change addresses three concrete failures in the local, offline pipeline:

- Native and imported quadruped chains can use different spellings, including
  `Front_Leg_Upper_L`, lowercase horse names and `FrontUpperLeg.L`.
  Complete, unambiguous fore/hind chains now share the same limb fitting pass.
  Individual feet and joint paths follow occupied mesh volume. Each leg has its
  own floor, so a raised paw is not forced to the floor of the other three.
- Short-bodied bipeds with large heads can have a distinct arm band below the
  old 55-percent height cutoff. A narrow, bilateral lateral band now supplies
  body proportions; torso volume supplies the leg/body junction and depth.
  Conventional human proportions retain the existing estimator.
- Broad ears were sometimes weighted to distant fingers. For large heads the
  skull correction now excludes local arm and hand capsules rather than every
  point closer to an arm than to the central skull axis. Its radial cutoff no
  longer assumes that a skull's width is comparable to its height. Normal-sized
  heads and facial rigs keep their existing behavior.

Joint names, parent topology, authored rotation bases and the built-in libraries
are retained. Reversible fitting still records Undo before applying positions.
No code, trained weights or datasets from RigAnything, UniMate or AnimalSyn3D
are incorporated in this patch.

## Validation

The public regression cases cover native template identity under a transformed
setup frame, humanoid fitting, clip calibration, editing, head/hand separation,
complete imported limb aliases and a raised quadruped leg. TypeScript checking
and the web build pass. Small type corrections also resolve pre-existing errors
in texture readback and model cleanup without changing their runtime behavior.

Private validation additionally fitted the eight supplied meshes and calculated
surface weights plus five samples of a native walking clip on six of them.
These included both large-headed bipeds and four quadrupeds. Rest-pose binding
and normalized weight checks passed; CPU-rendered posed surfaces were inspected.
The private inputs, generated geometry, reports and screenshots are not public
repository files.

## Remaining work

This is not a universal rigging or motion-retargeting solution. It does not add
trunk/tail articulation to human skeletons, fix the long-neck bird or the winged
dragon, provide foot-contact IK, or prove compatibility with every purchased
animation. Anatomical joint centers, accessories and deformations still require
review. There has been no new APK/device test or neural-model inference.

RigAnything is a separate research candidate for mesh-to-skeleton and skinning.
Its downloaded source archive excludes the trained checkpoint and its supplied
inference entry point selects CUDA. UniMate's motion generation assumes an
existing rig; AnimalSyn3D keypoint JSON does not supply surface skin weights.
