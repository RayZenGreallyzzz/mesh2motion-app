# Full humanoid binding and anatomical corrections

The room workspace now offers a complete humanoid build, independent of the optional native body solver. It loads the existing full hand/body template, retains the scene driver as a Group and binds the 65 anatomical joints. All ten finger chains, articulated phalanges, head/foot endpoints and body joints are retained. This does not pad the 23-joint native palette with empty joints.

New native body output is an intermediate: it receives this full binding before replacing the visible character. The native hand API is not invented or enabled through an unverified flag. Native body landmarks can be used when its private module is installed; the complete 65-joint action also works without that optional binary.

For native body inputs, reviewed body endpoints are retained. Elbow pivots are seeded from template segment ratios, then refined from triangle sections inside a bounded search. This avoids selecting distal cuffs as elbows. Knees use surface constriction/bend evidence. Wrist and ankle endpoints are preserved when parent joints move. Classic fitting retains its prior default search behavior; completion bounds are explicit options.

The skull pivot is fitted at the neck above the actual shoulder height. Ears/hair do not set that pivot from a percentage of total bounding-box height. Weights are recalculated with the existing welded surface/geodesic solver, head/torso protection and elbow/knee gradients. The worker can be cancelled without committing an incomplete result.

The GLB writer preserves the original geometry/image binary prefix and appends weights, inverse binds, new nodes and retargeted animations. Integer/normalized positions are copied into floating world coordinates for solving. Original mesh world transforms are retained, and inverse binds include each mesh bind transform. Replacement skin semantics are removed from a Draco primitive attribute map. Morph channels retain their original mesh targets. Rebuilds require a real rest/bind T/A pose; a posed skin whose vertices no longer match bind is rejected instead of silently changing visible shape.

The final contract checks 65 joints, all finger chains, normalized weights, bind invariance and a protected skull core above the neck transition. A skull core misassigned to shoulders or torso is rejected. Lower neck transitions and arm capsules remain blended. The visible source stays unchanged until the complete result loads and passes validation.

Public tests cover the human mesh with both profiles, weighted fingers, export/reload, motion transfer, integer positions, cancellation, cuff/knee fitting and prior own-rig/import behavior. The uploaded model stays local for numerical/mesh checks and is not committed to CI.

Android 8.2.2 uses a separate com.rayzen.riganimationstudio.humanoid65test package for comparison alongside the existing Native Test and its device library. The public shell contains no private native binary, signing key or owner texture. The room uses its bundled fallback if the private texture is absent. Updating the older native package requires the owner's saved signing backup.

This is not proof of ideal skinning on every topology. Actual owner clips still need review for hand poses, garment intersections and extreme bends. The uploaded GLB contained no animation tracks, so the recorded Pistol_Reload source is not a reproducible input here.
