# Recover from a native geometry limit

The device report stops in INITIAL_BODY_GUIDES with native error
MESH_TOO_COMPLEX_FOR_LOCAL_RIG / POSITION limit or type. PREPARE has already
completed Float32 expansion and WebP-to-PNG conversion. This is not a weight-solve
failure. The proprietary native module is unchanged and its exact vertex limit
is not inferred from this generic message.

The supplied raw GLB contains 365,147 vertices and 660,854 triangles. Its hash
differs from the reported original hash; the report's added float buffer size
is consistent with the same vertex count. Do not describe them as identical bytes.

Native failures now retain their typed code and raw receipt. A geometry-complexity
failure offers an explicit full-65 recovery button. It runs the existing full
humanoid builder on the original editor asset after the user chooses it. No
proxy, decimated mesh or replacement native output is passed as the final mesh.
The existing full-resolution worker solve, bind/skull validation, cancellation
and manual head review remain authoritative. The model is only replaced after
successful validation. The recovery offer clears when another model is opened.

Tests cover typed report preservation, no automatic fallback, original-byte
preservation, busy locking, unrelated errors and model replacement. Browser CI
simulates the reported native failure and completes recovery through a real
full-65 worker solve. It does not execute the ARM64 native module. The uploaded
private model is checked locally and is never put in public CI or the repository.
