# Rig Animation Studio v7.2 — Meshy-inspired joint view (experimental)

This is an **isolated feature branch** based on `codex/rig-studio-v71-own-rigs`. Do not merge into the installed production app without device testing.

## What is actually implemented

- Optional **«● Шарниры и круглые кости (тест)»** switch in the `Edit Skeleton` / `rig-setup-controls` panel.
- Collapsible **«◎ 12 ориентиров — как в Meshy (тест)»** guided landmark list: chin/head, shoulders, elbows, wrists, pelvis/groin, knees and ankles. Tapping a label selects and highlights an existing bone. Mapping is strict for Human and Mixamo naming: unknown joints cannot be assigned by guesswork. The user still moves joints with the existing editor.
- The skeleton preview can display actual 3D spherical joint markers and round cylinder bone links. The old octahedral bone display and flat points remain available.
- The selected view survives `regenerate_skeleton_helper` calls as joints are dragged.
- Same existing touch/joint editing interaction, mirror visibility, categories, and original model previews.
- Instanced drawing and explicit geometry/material disposal for tablet performance.
- Vitest guard checking that visual switching does not alter bone position, quaternion, or scale.
- Separate v7.2 Android test workflow with unique `applicationId` suffix `.v72test` so it does not overwrite installed Rig Animation Studio.

## What this is NOT

Meshy does not publish its skinning solver. This change **does not copy or recreate** its proprietary rigging method. It **does not** change AutoRig anatomy, bone rest orientation, bind matrices, skin weights, animation retargeting, or exported files. In particular, do not repeat the earlier unverified automatic arm-axis/bind change that was reverted due to severe arm twists on Neon Alleycat.

A spherical joint display is **visual and ergonomic**, not by itself a cure for stretched clothing or shoulders.

## How to test (after CI succeeds)

1. Install the v7.2 test APK alongside the existing app, never over it.
2. Import a regular GLB, choose the Human rig and enter `Edit Skeleton`.
3. In the rig position section, enable **«Шарниры и круглые кости (тест)»**. Compare with the old style via the same switch. Open **«12 ориентиров»** and choose a shoulder/elbow marker: the matching sphere must turn yellow. Drag the joint in the 3D view using the already supported editing mode.
4. Rotate the viewport, drag left shoulder/elbow, undo/redo and return to `Edit Skeleton`. The selected style should persist without changing joint placement.
5. Repeat with mirror on/off and with a skeleton containing many bones (e.g. Dragon).
6. Export and compare GLB structure against the baseline. There should be no changes caused **solely** by preview style.
7. Test the real device performance and render appearance; automated TypeScript/unit tests are not a replacement.

## Roadmap after this safe display baseline

- Extend the **existing** guided 12-marker selection to guided view alignment, per-marker validation and real placement feedback (do not rewrite the bind/rest pose).
- Explicit joint chain and local-axis diagnostics (especially upper arm → forearm), rest/bind consistency tests.
- Retarget animation basis mapping and weight diagnostics as independent opt-in stages, validated on real goblin, Neon Alleycat, Mixamo orc and dragon before enabling by default.
- Full visual and Android tests before any merge.

Original code and working versions remain unchanged.
