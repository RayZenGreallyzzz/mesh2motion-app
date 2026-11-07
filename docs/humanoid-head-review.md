# 8.2.3 candidate: head fitting and review

The full 65-joint humanoid builder previously stopped when its vertex-slice neck
search found fewer than ten nearby vertices. The model was preserved, but the
message offered manual review without any way to perform it.

The builder now falls back to closed triangle-surface sections. It requires a
coherent narrow band with a wider skull above it. Open or ambiguous sections do
not silently become a successful anatomical estimate. The result report identifies
vertex, surface or manually confirmed head fitting.

If fitting is uncertain, the Rig tab displays editable neck, skull-base and skull
end landmarks. Manual review can also be requested explicitly. Dragging or editing
coordinates resets confirmation. Front and side views must both be visited before
confirmation. Confirming resumes the full weight solve and the existing 65-joint
validation; no empty joints are appended and head-weight checks are not relaxed.

New native BODY23 output stays pending while head review is open. Its own coordinate
frame is shown for review, but the editor's original asset is not committed or
released. Cancel restores that original; confirm continues from the pending native
output. Model/motion imports and native guide actions are locked during review so
they cannot overwrite its markers. Viewer native-marker X reflection is adapted
at the panel boundary; builder landmarks remain in original GLB world coordinates.

Validation includes sparse closed/open surface fixtures, real public human mesh
manual-review/resume with bind/weight validation, pending native-output ownership,
marker coordinate conversion, cancellation, source replacement and the existing
joint, pose and retarget regressions. The browser workflow also exercises manual
head review, cancellation and a real worker completion before its mock native
bridge tests. That bridge does not execute the proprietary ARM64 engine.

## Android delivery

The workflow builds versionCode 823, package
`com.rayzen.riganimationstudio.humanoid65test`, for an update to 8.2.2. Its output
is a build shell, not a completed user APK. Final private assembly must include the
owner-supplied ARM64 module and licences, optional original room texture, and must
be signed with the existing rig65-test key from the 8.2.2 backup. Do not sign with
the older native-studio key: it belongs to a different installed package. No
private module, purchased model or signing key belongs in this public repository.

The gold humanoid shown in the user's screenshots has not been tested as geometry:
its GLB was not available. Device execution of the restored native module and
visual deformation checks remain necessary before claiming that model is fixed.
