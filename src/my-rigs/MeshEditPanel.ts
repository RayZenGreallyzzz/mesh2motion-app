import {
  BoxGeometry, BufferGeometry, Color, EdgesGeometry, Float32BufferAttribute, Group, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, PointsMaterial, Vector3,
  type Intersection, type Material, type SkinnedMesh
} from 'three'
import type { RigViewer } from './RigViewer.ts'
import type { RigAsset } from './RigAsset.ts'
import { brush_selection, cut_selection, deform_selection, is_bind_face, tint_selection, type MeshSelection } from './MeshEditGeometry.ts'
import type { MeshEdit } from './MeshEditGlb.ts'
import { knife_cut } from './MeshKnife.ts'
import { sample_surface_color } from './MeshEditColor.ts'
import type { TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js'

type Snapshot = { mesh: Mesh, geometry: BufferGeometry, material: Material | Material[] }
type Tool = 'camera' | 'select' | 'subtract' | 'axis' | 'knife' | 'dropper'
type Options = { apply(edits: MeshEdit[]): Promise<void>, status(message: string, error?: boolean): void }

export class MeshEditPanel {
  readonly element = document.createElement('div')
  private readonly message = document.createElement('p')
  private readonly tools = new Map<Tool, HTMLButtonElement>()
  private readonly actions: HTMLButtonElement[] = []
  private readonly tip_actions: HTMLButtonElement[] = []
  private readonly overlay = new Points(new BufferGeometry(), new PointsMaterial({ color: 0x79ffce, size: 4, sizeAttenuation: false, depthTest: false }))
  private readonly axis_marks = new Points(new BufferGeometry(), new PointsMaterial({ color: 0xffca7a, size: 9, sizeAttenuation: false, depthTest: false }))
  private readonly originals = new Map<Mesh, Snapshot>()
  private readonly undo_stack: Snapshot[] = []
  private readonly owned = new Set<BufferGeometry | Material>()
  private readonly radius = document.createElement('input')
  private readonly step = document.createElement('input')
  private readonly color = document.createElement('input')
  private readonly close_cut = document.createElement('input')
  private readonly blade_controls = document.createElement('div')
  private readonly brush_controls = document.createElement('div')
  private readonly seam_controls = document.createElement('div')
  private readonly plate = new Group()
  private readonly swatch = document.createElement('span')
  private readonly gizmo_modes = new Map<TransformControlsMode, HTMLButtonElement>()
  private readonly plate_sizes = [document.createElement('input'), document.createElement('input'), document.createElement('input')]
  private readonly slice: HTMLButtonElement
  private readonly recolor: HTMLButtonElement
  private readonly dropper: HTMLButtonElement
  private plate_target?: Mesh
  private plate_mode: TransformControlsMode = 'translate'
  private last_seam?: { mesh: Mesh, material: number }
  private sampled?: Color
  private readonly undo: HTMLButtonElement
  private readonly apply: HTMLButtonElement
  private readonly reset: HTMLButtonElement
  private readonly selection: MeshSelection = new Map()
  private readonly axis: Vector3[] = []
  private asset?: RigAsset
  private active_mesh?: Mesh
  private span = 1
  private tool: Tool = 'camera'
  private pending = false

  constructor(private readonly viewer: RigViewer, private readonly options: Options) {
    this.element.className = 'mesh-editor'
    const tool_row = document.createElement('div'); tool_row.className = 'mesh-editor-row'
    for (const [tool, label] of [['camera', 'Камера'], ['select', 'Выделить'], ['subtract', 'Снять'], ['axis', 'Ось кончика'], ['knife', 'Нож']] as const) {
      const button = this.button(label, () => this.set_tool(tool))
      this.tools.set(tool, button); tool_row.append(button)
    }
    const hints = document.createElement('p'); hints.className = 'hint'
    hints.textContent = 'Модель можно крутить и приближать во время правки.'
    this.message.className = 'hint mesh-editor-selection'; this.message.setAttribute('aria-live', 'polite')
    const clear = this.button('Снять всё', () => this.clear())
    const sizes = document.createElement('div'); sizes.className = 'mesh-editor-inputs'
    sizes.append(this.slider(this.radius, 'Кисть', .1, 15, 2, '%', .1), this.slider(this.step, 'Сила правки', 1, 80, 22))
    const shift_label = document.createElement('p'); shift_label.className = 'hint'; shift_label.textContent = 'Сдвиг относительно камеры'
    const nudges = document.createElement('div'); nudges.className = 'mesh-editor-row'
    for (const [label, x, y, z] of [
      ['←', -1, 0, 0], ['→', 1, 0, 0], ['↑', 0, 1, 0], ['↓', 0, -1, 0], ['От камеры', 0, 0, -1], ['К камере', 0, 0, 1]
    ] as const) {
      const button = this.button(label, () => this.translate(x, y, z), true)
      const directions: Record<string, string> = {'←': 'влево', '→': 'вправо', '↑': 'вверх', '↓': 'вниз'}
      if (directions[label]) button.setAttribute('aria-label', 'Сдвинуть ' + directions[label])
      nudges.append(button)
    }
    const tips = document.createElement('div'); tips.className = 'mesh-editor-row'
    for (const [text, shorten] of [['Укоротить кончик', true], ['Сузить конусом', false]] as const) {
      const button = this.button(text, () => this.taper(shorten), true)
      this.tip_actions.push(button); tips.append(button)
    }
    const cut = document.createElement('div'); cut.className = 'mesh-editor-row'
    const cap = document.createElement('label'); this.close_cut.type = 'checkbox'; this.close_cut.checked = true
    cap.append(this.close_cut, ' Закрыть срезы')
    cut.append(this.button('Удалить выделенное', () => this.cut(), true))
    const tint = document.createElement('div'); tint.className = 'mesh-editor-row'
    this.color.type = 'color'; this.color.value = '#678ec4'; this.color.setAttribute('aria-label', 'Цвет тонировки')
    tint.append(this.color, this.button('Подкрасить', () => this.paint(), true))
    const finish = document.createElement('div'); finish.className = 'mesh-editor-row'
    this.undo = this.button('Отменить шаг', () => this.undo_edit())
    this.reset = this.button('Сбросить правки', () => this.revert())
    this.apply = this.button('Применить', () => { void this.commit() })
    this.apply.className = 'primary'
    finish.append(this.undo, this.reset, this.apply)
    this.brush_controls.className = this.blade_controls.className = 'mesh-editor-section'
    this.brush_controls.append(sizes, clear, shift_label, nudges, tips, cut, tint)
    this.slice = this.button('Отрезать', () => { void this.slice_mesh() })
    this.slice.className = 'primary'
    const modes = document.createElement('div'); modes.className = 'mesh-editor-row'
    for (const [mode, label] of [['translate', 'Сдвиг'], ['rotate', 'Поворот'], ['scale', 'Масштаб']] as const) {
      const button = this.button(label, () => { this.plate_mode = mode; this.show_gizmo(); this.refresh() })
      this.gizmo_modes.set(mode, button); modes.append(button)
    }
    const dimensions = document.createElement('div'); dimensions.className = 'mesh-plate-dimensions'
    const names = ['Толщина', 'Высота', 'Глубина'], limits = [[.01, 2, .05], [.2, 50, 7], [.2, 50, 8]]
    this.plate_sizes.forEach((input, axis) => {
      const [min, max, value] = limits[axis]
      dimensions.append(this.slider(input, names[axis], min, max, value, '%', .01, () => {
        this.plate.scale.setComponent(axis, this.span * Number(input.value) / 100)
      }))
    })
    const blade_actions = document.createElement('div'); blade_actions.className = 'mesh-editor-row'
    blade_actions.append(this.button('Поставить заново', () => this.place_again()), this.slice)
    this.blade_controls.append(modes, dimensions, blade_actions)
    this.seam_controls.className = 'mesh-editor-row'
    this.swatch.className = 'mesh-seam-swatch'; this.swatch.setAttribute('aria-label', 'Образец цвета')
    this.dropper = this.button('Пипетка', () => this.set_tool('dropper'))
    this.recolor = this.button('Закрасить стык', () => this.color_seam())
    this.seam_controls.append(this.dropper, this.swatch, this.recolor)
    this.element.append(tool_row, hints, this.message, this.brush_controls, this.blade_controls, cap, this.seam_controls, finish)
    const box = new BoxGeometry()
    const glass = new Mesh(box, new MeshBasicMaterial({ color: 0x99ddff, transparent: true, opacity: .28, depthWrite: false }))
    const outline = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: 0xc3ecff, transparent: true, opacity: .7, depthWrite: false, depthTest: false }))
    glass.renderOrder = 10; outline.renderOrder = 11
    this.plate.add(glass, outline); this.plate.visible = false
    this.overlay.renderOrder = this.axis_marks.renderOrder = 1000
    this.overlay.frustumCulled = this.axis_marks.frustumCulled = false
    this.refresh()
  }

  get is_pending (): boolean { return this.pending }
  get has_edits (): boolean { return this.originals.size > 0 }

  start (asset: RigAsset): void {
    this.asset = asset
    this.viewer.stop(false)
    asset.scene.updateMatrixWorld(true)
    const span = this.viewer.model_size()
    this.span = Math.max(span, .00001)
    this.viewer.scene.add(this.overlay, this.axis_marks, this.plate)
    this.set_tool('camera')
  }

  end (): void {
    this.revert()
    this.asset = undefined
    this.viewer.set_mesh_picker(); this.viewer.edit_gizmo()
    this.overlay.removeFromParent(); this.axis_marks.removeFromParent(); this.plate.removeFromParent()
  }

  private button (label: string, handler: () => void, action = false): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label
    button.onclick = () => {
      if (this.pending) return
      try { handler() } catch (error) { this.options.status((error as Error).message, true) }
    }
    if (action) this.actions.push(button)
    return button
  }

  private slider (input: HTMLInputElement, name: string, min: number, max: number, value: number,
    units = '%', step = 1, changed?: () => void): HTMLElement {
    const label = document.createElement('label'), amount = document.createElement('output')
    input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value); input.step = String(step)
    const update = (): void => { amount.textContent = input.value + units; changed?.() }
    input.oninput = update; update()
    label.append(name, ' ', amount, input); return label
  }

  private set_tool (tool: Tool): void {
    this.tool = tool
    this.viewer.edit_gizmo()
    if (tool === 'axis') this.axis.length = 0
    if (tool === 'knife' && this.plate_target) this.show_gizmo()
    else if (tool === 'knife') this.place_again()
    else if (tool === 'dropper') this.viewer.set_mesh_picker(hit => {
      try {
        this.sampled = sample_surface_color(hit)
        this.swatch.style.backgroundColor = '#' + this.sampled.getHexString()
        this.set_tool(this.plate_target ? 'knife' : 'camera')
        this.options.status('Цвет взят. Нажмите «Закрасить стык».')
      } catch (error) { this.options.status((error as Error).message, true) }
    })
    else this.viewer.set_mesh_picker(tool === 'camera' ? undefined : hit => {
      try { this.pick(hit) } catch (error) { this.options.status((error as Error).message, true) }
    })
    this.draw_selection(); this.refresh()
  }

  private place_again (): void {
    this.plate_target = undefined; this.plate.visible = false
    this.viewer.edit_gizmo()
    this.viewer.set_mesh_picker(hit => {
      if (this.pending) return
      try {
        this.check_bind(hit)
        this.plate_target = hit.object
        this.plate.position.copy(hit.point)
        this.plate.quaternion.copy(this.viewer.camera_rotation())
        this.plate_sizes.forEach((input, i) => this.plate.scale.setComponent(i, this.span * Number(input.value) / 100))
        this.plate.position.add(new Vector3(0, 0, -this.plate.scale.z * .45).applyQuaternion(this.plate.quaternion))
        this.plate_mode = 'translate'; this.plate.visible = true
        this.show_gizmo(); this.refresh()
      } catch (error) { this.options.status((error as Error).message, true) }
    }, true)
    this.refresh()
  }

  private show_gizmo (): void {
    this.viewer.set_mesh_picker()
    this.viewer.edit_gizmo(this.plate, this.plate_mode, () => {
      for (const [i, input] of this.plate_sizes.entries()) {
        const percent = this.plate.scale.getComponent(i) / this.span * 100
        const clamped = Math.max(Number(input.min), Math.min(Number(input.max), percent))
        this.plate.scale.setComponent(i, this.span * clamped / 100)
        input.value = String(clamped)
        const amount = input.parentElement?.querySelector('output')
        if (amount) amount.textContent = Math.round(clamped * 100) / 100 + '%'
      }
    })
  }

  private check_bind ({object, face}: Pick<Intersection<Mesh>, 'object' | 'face'>): void {
    if (!face) throw new Error('Коснитесь поверхности модели.')
    if (!is_bind_face(object, face, this.span * .0001)) throw new Error('Для этой правки откройте модель в позе привязки.')
  }

  private pick ({object, face, point}: Intersection<Mesh>): void {
    if (this.pending || !face || !this.asset) return
    this.check_bind({object, face})
    if (this.tool === 'axis') {
      if (!this.active_mesh || this.active_mesh !== object || !this.selection.size) throw new Error('Сначала выделите область кончика.')
      this.axis.push(point.clone())
      if (this.axis.length === 2) this.set_tool('select')
    } else {
      if (this.active_mesh !== object && this.tool === 'subtract') return
      if (this.active_mesh !== object) { this.clear(); this.active_mesh = object }
      const radius = this.span * Number(this.radius.value) / 100
      const patch = brush_selection(object.geometry, object.matrixWorld, point, face, radius)
      if (!patch.size) throw new Error('Увеличьте кисть, чтобы захватить вершины.')
      for (const [key, w] of patch) {
        if (this.tool === 'subtract') this.selection.delete(key)
        else this.selection.set(key, Math.max(w, this.selection.get(key) ?? 0))
      }
    }
    this.draw_selection(); this.refresh()
  }

  private draw_selection (): void {
    const values: number[] = [], mesh = this.active_mesh, point = new Vector3()
    if (mesh && this.tool !== 'knife') {
      const stride = Math.max(1, Math.ceil(this.selection.size / 9000))
      let n = 0
      for (const i of this.selection.keys()) {
        if (n++ % stride) continue
        point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld)
        values.push(point.x, point.y, point.z)
      }
    }
    this.draw_points(this.overlay, values)
    this.draw_points(this.axis_marks, this.axis.flatMap(p => p.toArray()))
  }

  private draw_points (points: Points, values: number[]): void {
    points.geometry.dispose()
    points.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(values, 3))
  }

  private clear (): void {
    this.active_mesh = undefined; this.selection.clear(); this.axis.length = 0
    this.draw_selection(); this.refresh()
  }

  private async slice_mesh (): Promise<void> {
    const mesh = this.plate_target!
    this.plate.updateMatrixWorld(true); mesh.updateWorldMatrix(true, false)
    const to_blade = this.plate.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
    this.pending = true; this.refresh(); this.viewer.edit_gizmo()
    this.options.status('Выполняю разрез…')
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const result = knife_cut(mesh.geometry, to_blade, this.close_cut.checked)
      let materials = mesh.material
      if (result.seam !== undefined) {
        const items = Array.isArray(materials) ? materials.slice() : [materials]
        items[result.seam] = items[0]
        materials = items
      }
      this.replace(mesh, result.geometry, materials)
      this.last_seam = result.seam === undefined ? undefined : { mesh, material: result.seam }
      this.sampled = undefined; this.swatch.style.backgroundColor = ''
      this.plate_target = undefined; this.plate.visible = false
      this.clear(); this.set_tool('camera')
      const note = this.last_seam ? ' Для цвета используйте «Пипетку».' : ''
      this.options.status(result.open ? 'Разрез готов. Часть кромки осталась открытой.' + note : 'Разрез готов, кромки закрыты.' + note)
    } catch (error) {
      this.options.status((error as Error).message, true)
      if (this.plate_target) this.show_gizmo()
    } finally {
      this.pending = false; this.refresh()
    }
  }

  private color_seam (): void {
    const {mesh, material} = this.last_seam!
    const materials = (mesh.material as Material[]).slice()
    const color = this.sampled!
    const cap = new MeshStandardMaterial({ color, roughness: .85, metalness: 0, flatShading: true })
    cap.userData.studioSeamColor = color.toArray()
    this.owned.add(cap); materials[material] = cap
    this.replace(mesh, mesh.geometry, materials)
    this.options.status('Цвет нанесён на стык.')
  }

  private translate (x: number, y: number, z: number): void {
    const mesh = this.active_mesh!
    const inverse = new Matrix4().copy(mesh.matrixWorld).invert()
    const offset = this.viewer.view_direction(x, y, z).multiplyScalar(this.span * Number(this.step.value) / 1000)
    const local = offset.clone().applyMatrix4(inverse).sub(new Vector3().applyMatrix4(inverse))
    this.replace(mesh, deform_selection(mesh.geometry, this.selection, (p, w) => p.addScaledVector(local, w)))
    this.axis.length = 0; this.draw_selection(); this.refresh()
  }

  private taper (shorten: boolean): void {
    const mesh = this.active_mesh!, inverse = mesh.matrixWorld.clone().invert()
    const origin = this.axis[0], axis = this.axis[1].clone().sub(origin)
    const length = axis.length()
    if (length < this.span * .001) throw new Error('Разведите точки основания и кончика.')
    axis.divideScalar(length)
    const strength = Number(this.step.value) / 100, center = new Vector3(), radial = new Vector3()
    const geometry = deform_selection(mesh.geometry, this.selection, (local, w) => {
      const p = local.applyMatrix4(mesh.matrixWorld), t = radial.copy(p).sub(origin).dot(axis)
      const ratio = Math.max(0, Math.min(1, t / length))
      if (shorten) p.addScaledVector(axis, -length * strength * ratio * ratio * w)
      else p.addScaledVector(radial.copy(center.copy(origin).addScaledVector(axis, t)).sub(p), strength * ratio * w)
      return p.applyMatrix4(inverse)
    })
    this.replace(mesh, geometry)
    this.axis.length = 0; this.draw_selection(); this.refresh()
  }

  private cut (): void {
    const mesh = this.active_mesh!
    const cut = cut_selection(mesh.geometry, this.selection, this.close_cut.checked)
    this.replace(mesh, cut.geometry); this.clear()
    this.options.status('Удалено треугольников: ' + cut.removed + (cut.open ? '. У среза могут остаться открытые края.' : '. Контуры среза закрыты.'))
  }

  private paint (): void {
    const mesh = this.active_mesh!, source = mesh.material
    const tint = (material: Material): Material => {
      if (material.vertexColors) return material
      const copy = material.clone(); copy.vertexColors = true; this.owned.add(copy); return copy
    }
    const geometry = tint_selection(mesh.geometry, this.selection, new Color(this.color.value), Number(this.step.value) / 100)
    this.replace(mesh, geometry, Array.isArray(source) ? source.map(tint) : tint(source))
  }

  private replace (mesh: Mesh, geometry: BufferGeometry, material = mesh.material): void {
    const snapshot = {mesh, geometry: mesh.geometry, material: mesh.material}
    if (!this.originals.has(mesh)) this.originals.set(mesh, snapshot)
    this.undo_stack.push(snapshot); if (this.undo_stack.length > 4) this.undo_stack.shift()
    this.owned.add(geometry); this.restore({mesh, geometry, material}); this.collect(); this.refresh()
  }

  private restore ({mesh, geometry, material}: Snapshot): void {
    mesh.geometry = geometry; mesh.material = material
    const skin = mesh as SkinnedMesh
    if (skin.isSkinnedMesh) Object.assign(skin, { boundingBox: null, boundingSphere: null })
  }

  private collect (): void {
    const keep = new Set<BufferGeometry | Material>()
    for (const entry of [...this.undo_stack, ...[...this.originals.keys()].map(mesh => ({geometry: mesh.geometry, material: mesh.material}))]) {
      keep.add(entry.geometry)
      for (const material of Array.isArray(entry.material) ? entry.material : [entry.material]) keep.add(material)
    }
    for (const resource of this.owned) if (!keep.has(resource)) { resource.dispose(); this.owned.delete(resource) }
  }

  private undo_edit (): void {
    const previous = this.undo_stack.pop()
    if (!previous) return
    this.restore(previous)
    const original = this.originals.get(previous.mesh)
    if (previous.geometry === original?.geometry && previous.material === original.material) this.originals.delete(previous.mesh)
    if (this.last_seam && !this.last_seam.mesh.geometry.groups.some(group => group.materialIndex === this.last_seam!.material)) this.last_seam = undefined
    this.collect(); this.clear()
  }

  private revert (): void {
    for (const previous of this.originals.values()) this.restore(previous)
    this.originals.clear(); this.undo_stack.length = 0
    this.last_seam = undefined; this.sampled = undefined; this.swatch.style.backgroundColor = ''
    this.plate_target = undefined; this.plate.visible = false
    if (this.asset) this.set_tool('camera')
    this.collect(); this.clear()
  }

  private async commit (): Promise<void> {
    const edits: MeshEdit[] = []
    for (const [mesh, previous] of this.originals) {
      const node = [...this.asset!.nodes.values()].find(node => node.object === mesh)
      if (!node) { this.options.status('Не найдена деталь для сохранения.', true); return }
      const seam_colors = new Map<number, [number, number, number]>()
      if (Array.isArray(mesh.material)) mesh.material.forEach((material, index) => {
        const color = material.userData.studioSeamColor as [number, number, number] | undefined
        if (color) seam_colors.set(index, color)
      })
      edits.push({id: node.id, original: previous.geometry, geometry: mesh.geometry, seam_colors})
    }
    this.pending = true; this.refresh()
    try { await this.options.apply(edits) }
    catch (error) { this.options.status((error as Error).message, true) }
    finally { this.pending = false; this.refresh() }
  }

  private refresh (): void {
    for (const [tool, button] of this.tools) {
      button.setAttribute('aria-pressed', String(tool === this.tool)); button.disabled = this.pending
    }
    for (const button of this.actions) button.disabled = this.pending || !this.selection.size
    for (const button of this.tip_actions) button.disabled ||= this.axis.length !== 2
    this.apply.disabled = this.reset.disabled = this.pending || !this.has_edits
    this.undo.disabled = this.pending || !this.undo_stack.length
    this.close_cut.disabled = this.pending
    this.brush_controls.hidden = this.tool === 'knife' || this.tool === 'dropper'
    this.blade_controls.hidden = this.tool !== 'knife'
    this.seam_controls.hidden = !this.last_seam
    this.dropper.disabled = this.pending
    this.dropper.setAttribute('aria-pressed', String(this.tool === 'dropper'))
    this.recolor.disabled = this.pending || !this.last_seam || !this.sampled
    this.slice.disabled = this.pending || !this.plate_target
    for (const [mode, button] of this.gizmo_modes) {
      button.disabled = this.pending || !this.plate_target
      button.setAttribute('aria-pressed', String(mode === this.plate_mode))
    }
    for (const input of this.plate_sizes) input.disabled = this.pending || !this.plate_target
    this.message.textContent = this.tool === 'knife'
      ? this.plate_target ? 'Выставьте пластину гизмо. Поверните модель, чтобы проверить глубину.' : 'Коснитесь модели рядом со швом, чтобы поставить пластину.'
      : this.tool === 'dropper' ? 'Коснитесь поверхности нужного цвета.'
      : this.tool === 'axis' ? this.axis.length ? 'Коснитесь кончика.' : 'Коснитесь основания кончика.'
      : this.selection.size ? 'Выделено вершин: ' + this.selection.size.toLocaleString('ru') : 'Выделите прядь или перемычку.'
  }
}
