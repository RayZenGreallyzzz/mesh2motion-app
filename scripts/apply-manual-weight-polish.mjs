import fs from 'node:fs'

const path = 'src/Mesh2MotionEngine.ts'
let source = fs.readFileSync(path, 'utf8')

if (!source.includes('manual_weight_last_sample_ms')) {
  const property = '  private manual_weight_stroke_vertices: Map<number, Set<number>> | null = null\n'
  if (!source.includes(property)) throw new Error('Manual weight stroke property marker not found')
  source = source.replace(
    property,
    property + '  private manual_weight_last_sample_ms: number = -Infinity\n'
  )

  const collectStart = `  private collect_manual_weight_vertices (event: PointerEvent): boolean {\n    if (!this.is_manual_weight_editor_enabled() || this.manual_weight_stroke_vertices === null) return false\n\n`
  if (!source.includes(collectStart)) throw new Error('Manual weight collect marker not found')
  source = source.replace(
    collectStart,
    collectStart + `    // High-poly mobile characters can have hundreds of thousands of vertices.\n    // Sampling every raw pointermove would scan the mesh far more often than the\n    // screen can usefully display and causes tablet hitching. Keep painting fluid\n    // while capping the expensive spatial scan to roughly 18 Hz.\n    const now = event.timeStamp\n    if (now - this.manual_weight_last_sample_ms < 55) return true\n    this.manual_weight_last_sample_ms = now\n\n`
  )

  const beginMarker = `  public begin_manual_weight_stroke (event: PointerEvent): boolean {\n    if (!this.is_manual_weight_editor_enabled()) return false\n    this.manual_weight_stroke_vertices = new Map<number, Set<number>>()\n`
  if (!source.includes(beginMarker)) throw new Error('Manual weight begin marker not found')
  source = source.replace(
    beginMarker,
    beginMarker + '    this.manual_weight_last_sample_ms = -Infinity\n'
  )
}

// Only request the selected-bone heatmap when the manual brush is actually on.
const previewMarker = `    const selected = Number.parseInt(select.value, 10)\n    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)\n    this.update_manual_weight_labels()\n`
if (source.includes(previewMarker)) {
  source = source.replace(
    previewMarker,
    `    const selected = Number.parseInt(select.value, 10)\n    const weight_enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null\n    this.weight_skin_step.set_manual_weight_preview_bone(\n      (weight_enabled?.checked ?? false) && Number.isFinite(selected) ? selected : null\n    )\n    this.update_manual_weight_labels()\n`
  )
}

fs.writeFileSync(path, source)
console.log('Manual weight tablet performance polish applied')
