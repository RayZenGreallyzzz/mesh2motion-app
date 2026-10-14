# Rig Studio v6.6 joint volume test

Based on the v6.5 arm coverage build, without changing the edited rig's rest
axes, stock animation files or model geometry.

## Problems addressed

- Seed buckets could anchor an opposite calf on the same connected trouser
  surface. Each surface seed now belongs to its nearest segment. A continuous
  local-distance penalty limits broad cross-limb weights while retaining the
  geodesic path and smooth joint transitions.
- Linear blending flattens elbow/knee cross-sections at large bends. Four
  additional deform bones follow half the local joint bend. Only dominant
  parent/child weights close to each joint are redistributed. Original bone
  indices and editable bones remain unchanged. Ordinary skin weights and
  generated quaternion tracks preserve this correction in exported models.
- The animation panel's children had fixed widths exceeding its mobile width.
  The panel now has a 24px edge inset plus the device safe area, responsive
  two-column tiles, a wrapping filter row, and a separate full-width arm slider
  with a 44px touch area. The props dock includes the panel's edge inset.
- Slider input previously rebuilt all 178 clips. A revision cache updates the
  active clip immediately and resolves other clips when selected or exported.

## Validation

- Automated coverage includes both sides of the elbow/knee at 140 degrees,
  identity bind deformation, normalized four-slot weights, repeated setup,
  playback-speed independence, optional generated tracks on custom imports,
  GLB export/reload deformation equality, and lazy warp/export invalidation.
- The controlled cylinder's minimum joint radius at 140 degrees is 0.18 with
  support, versus about 0.062 with the original linear blend (rest radius 0.18).
- CPU skinning probes used Graffiti Alley Cat with Sprint, Run Anime, Run Female
  and Walk Large. In the sampled left calf center, mean opposite-leg influence
  falls from about 13.4% to zero; in the left thigh sample, opposite-thigh
  influence falls from about 16.7% to 4.5%. These measurements are regional,
  not claims of zero cross-influence over every vertex or model.
- On the original Neon Alleycat, the Bow Pull Back sleeve regression at frame
  23 has maximum extra edge length 0.0116/0.0133 (left/right), versus
  0.0190/0.0298 in v6.5. Model files and diagnostic renders are not committed.
- The workflow gates the APK on the full Vitest suite and Chromium touch
  drags through 7%, -50%, both slider extremes, and back, at 533x853, 800x1280,
  1280x800 and 360x800. Internal panel screenshots are CI artifacts.

## Installation and limits

The workflow produces **Rig Studio v6.6 TEST**, application ID
`com.rayzen.riganimationstudio.v66test`, installed separately from earlier
builds. Import the original model and recalculate/bind weights to use the new
solver and joint support. Already-exported old weights are not retroactively
repaired by selecting another animation.

No physical Android device/emulator validation was performed here. Joint
support improves the ordinary skinning blend; it does not supply missing
anatomy, garment simulation, or correct manually misplaced joint locations.
GLB round-trip behavior is tested; FBX uses the same ordinary bone/track data
but has not been round-trip tested in an external DCC application.
