# Rig Animation Studio v6.5 arm coverage test build

Based on v6.4 commit `39d777b897027357e8f99674ee2736da768161ff`. All 129 application source files recovered from the supplied v6.4 APK matched this branch before editing.

## Cause and changes

The supplied Neon Alleycat has 153,577 vertices, 125,789 welded nodes and two surface components. Sparse whole-component sampling excluded both upper arms, both clavicles and the right lower arm. Both upper arms consequently received zero vertex weights.

- Visit every welded node when selecting locally relevant bones. Preserve the local nearest-four rule and small-accessory cutoff, but remove the arbitrary 32-bone component limit.
- Seed each segment in four length bands and eight angular sectors. A dense, narrow ring can no longer consume the entire seed pool.
- Preserve existing surface-derived weights while smoothing. The hierarchy limit controls newly introduced influences; it must not delete an existing blend when the dominant bone changes.
- Use allocation-free scalar point-to-segment distances to contain the cost of the coverage pass.

Joint fitting, rest poses, animation retargeting, manual painting, hand presets and existing Android workflows are unchanged.

## Validation

- 148 tests passed in 24 test files; changed TypeScript files pass ESLint and `git diff --check`.
- Four new regressions fail with the original v6.4 solver and pass with this change: missing middle segments, more than 32 relevant segments, tapered-surface seed starvation, and erased cross-chain blends. The disconnected-accessory and elbow-blending checks also pass.
- Recomputed the original cat with the unmodified v6.4 automatic fit and `Bow Pull Back` at 23/30 seconds. In the sampled shoulder-to-elbow regions, the upper-arm bone became dominant on 755/1,030 left-side vertices and 670/670 right-side vertices (previously zero on both).
- The largest extra edge length in the sleeve comparison region fell from 0.352 to 0.030 scene units. Region: `0.18 < abs(x) < 0.43`, `1.2 < y < 1.55`, measured at edge midpoints in the floor-aligned bind mesh; edges shorter than 0.0001 were excluded. This is a diagnostic for this model and pose, not a bound for all animations.
- Surface solve measured about 3.9 seconds in the test environment, versus about 2.7 seconds for v6.4. Android timing has not been measured.

The original model is not committed to the repository. Visual comparison used CPU skinning of its actual geometry. This does not reproduce any unpublished manual joint edits or constitute a test on a physical Android device.

## Android test build

Workflow: `.github/workflows/rig-studio-v65-arm-coverage.yml`.

APK: `Rig-Animation-Studio-v6.5-Arm-Coverage-test.apk`.

Application ID: `com.rayzen.riganimationstudio.v65test`; launcher name: `Rig Studio v6.5 TEST`. Installs alongside v6.4. Import the original model and recalculate weights; previously exported GLBs retain their old skin weights.
