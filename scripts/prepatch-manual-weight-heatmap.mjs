import fs from 'node:fs'

const path = 'src/lib/Generators.ts'
let source = fs.readFileSync(path, 'utf8')

if (source.includes('selected_bone_index: number | null')) {
  console.log('Manual weight heatmap already present')
  process.exit(0)
}

const oldSignature = '  static create_weight_painted_mesh (skin_indices: number[], orig_geometry: BufferGeometry): Mesh {'
const newSignature = `  static create_weight_painted_mesh (
    skin_indices: number[],
    orig_geometry: BufferGeometry,
    skin_weights: number[] = [],
    selected_bone_index: number | null = null
  ): Mesh {`

if (!source.includes(oldSignature)) {
  throw new Error('Weight painted mesh signature marker not found')
}
source = source.replace(oldSignature, newSignature)

const startMarker = '    // Loop through each vertex and assign color based on the bone index\n'
const endMarker = "    cloned_geometry.setAttribute('color', new BufferAttribute(colors, 3))\n"
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker, start)
if (start < 0 || end < 0) {
  throw new Error('Weight color loop markers not found')
}

const replacement = `    // When a bone is selected by the manual weight editor, show a heatmap of
    // that bone's actual normalized influence. Otherwise retain the original
    // deterministic per-bone colors used by the general weight preview.
    const colors = new Float32Array(vertex_count * 3)
    for (let i = 0; i < vertex_count; i++) {
      if (selected_bone_index !== null && skin_weights.length >= (i + 1) * 4) {
        let selected_weight = 0
        for (let slot = 0; slot < 4; slot++) {
          if (skin_indices[i * 4 + slot] === selected_bone_index) {
            selected_weight += skin_weights[i * 4 + slot] ?? 0
          }
        }
        selected_weight = Math.max(0, Math.min(1, selected_weight))

        // Dark blue = no influence, bright magenta = full influence.
        colors[i * 3] = 0.07 + selected_weight * 0.93
        colors[i * 3 + 1] = 0.09 + selected_weight * 0.10
        colors[i * 3 + 2] = 0.16 + selected_weight * 0.72
      } else {
        const bone_index = skin_indices[i * 4] // Primary bone assignment
        let color = bone_colors[bone_index]
        if (color == null || color === undefined) {
          color = new Vector3(1, 1, 1)
        }
        colors[i * 3] = color.x
        colors[i * 3 + 1] = color.y
        colors[i * 3 + 2] = color.z
      }
    }
`

source = source.slice(0, start) + replacement + source.slice(end)
fs.writeFileSync(path, source)
console.log('Manual selected-bone heatmap prepatch applied')
