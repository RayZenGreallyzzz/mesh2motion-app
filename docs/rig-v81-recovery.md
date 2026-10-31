# Rig Animation Studio v8.1 recovery

This branch restores the v8.1 application source from the source archive delivered on 2026-10-31. The previous GitHub branch stopped at the v7.2 joint editor. This checkpoint is a reported-broken baseline, not a stable release or a claim that the current rigging works correctly.

The user supplied screenshots and a 53-second video of a horned female character with collapsed arms during animation in Human/Woman. Those media establish a visible problem. The exact original GLB for that character has not yet been identified, so the cause of that deformation remains unconfirmed.

An additional failure was reproduced on a previously supplied wide-stance character: repeatedly fitting Human uses the already fitted proportions as the template. After four repeats the head endpoint drifts 0.4874 in a model normalized to height 2. Woman already caches original offsets and does not show this particular drift.

Earlier finite-value, normalized-weight and bind-matrix tests do not establish correct anatomy or visual deformation. Subsequent fixes must distinguish verified numerical behavior from visual confirmation on the reported model.

The source recovery preserves the existing GitHub assets and Android build history. It excludes signing keys, APKs, user meshes and recordings. The archive's build initially needs its v7.3 offline assets; reproducible build restoration and targeted regression checks follow in separate commits. Do not run an old release patch workflow against this recovery branch or call this checkpoint an APK release.

Source archive SHA-256: `1a5ee14eee1bc831b02a42c24ebc0bef77a57ae8513f75fbd7e0c93ffb735112`.
