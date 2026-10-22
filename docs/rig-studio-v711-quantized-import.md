# Rig Studio v7.1.1 TEST: quantized GLB import repair

The Create importer baked mesh node transforms directly into integer POSITION
attributes used by KHR_mesh_quantization. Small-scale gltfpack models lost their
fractional coordinates; vertices could all become zero while the UI still
advanced to skeleton selection.

Before baking, the importer now decodes positions, normals and tangents into
independent Float32 buffers using attribute getters. This preserves normalized
integer values and interleaved strides. Indices, UVs and materials retain their
existing processing. The source geometry is not mutated. The own-rig route and
its Android memory limits are unchanged.

Regression coverage includes both unsigned interleaved positions and signed
normalized positions/normals/tangents, a real GLB upload with an actual screen
pixel comparison, and an offline Android WebView render check. The fixture is
original synthetic geometry; private reference models are never committed or
uploaded with CI artifacts.

The APK uses a distinct v711test application ID and installs alongside earlier
test builds. Local libraries belong to each installation; existing models can
be transferred by exporting and importing their GLB files.
