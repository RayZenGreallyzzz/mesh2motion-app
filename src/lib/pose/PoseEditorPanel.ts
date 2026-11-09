import { Box3, type Bone, type SkinnedMesh, Vector3 } from 'three'
import { PoseCalibration } from './PoseCalibration.ts'
import './pose-editor.css'

interface Options { applied(): void, closed(): void, layout?(width: number, height: number): void }
export class PoseEditorPanel {
  private calibration?: PoseCalibration
  private selected?: Bone
  private floor = 0
  private readonly element = document.createElement('section')
  private readonly select = document.createElement('select')
  private readonly message = document.createElement('p')
  private readonly rotations: HTMLInputElement[] = []
  private readonly positions: HTMLInputElement[] = []
  get open(): boolean { return !this.element.hidden }
  constructor(container: HTMLElement, private readonly options: Options, floating = false) {
    this.element.className = 'pose-editor-panel' + (floating ? ' floating-pose-editor' : ''); this.element.hidden = true; this.element.setAttribute('role', 'region'); this.element.setAttribute('aria-label', 'Исходная поза персонажа')
    const heading = document.createElement('strong'); heading.textContent = 'Исходная поза рук и ног'
    const hint = document.createElement('p'); hint.textContent = 'Выберите кость и задайте позу. Поправка сохранится в анимациях и экспорте.'
    this.select.setAttribute('aria-label', 'Кость для исходной позы'); this.select.onchange = () => { this.selected = this.calibration?.bones.find(b => b.uuid === this.select.value); this.fields() }
    this.element.append(heading, hint, this.select)
    const fields = (caption: string, rotation: boolean): void => {
      const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = caption; group.append(legend)
      for (let axis = 0; axis < 3; axis++) {
        const row = document.createElement('label'); row.textContent = ['X', 'Y', 'Z'][axis]
        const input = document.createElement('input'); input.type = rotation ? 'range' : 'number'; input.setAttribute('aria-label', caption + ' ' + ['X', 'Y', 'Z'][axis]); input.step = rotation ? '0.5' : '0.005'
        if (rotation) { input.min = '-180'; input.max = '180' }; input.value = '0'; input.oninput = () => this.change()
        const output = document.createElement('output'); output.textContent = '0'; row.append(input, output); group.append(row); (rotation ? this.rotations : this.positions).push(input)
      }
      this.element.append(group)
    }
    fields('Поворот, °', true); fields('Сдвиг сустава', false)
    const button = (text: string, action: () => void): HTMLButtonElement => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; return b }
    this.element.append(button('Опустить лапу на пол', () => {
      if (!this.calibration || !this.selected) return
      try { const result = this.calibration.lower_to_floor(this.selected, this.floor); this.fields(); this.message.textContent = result.error < 0.001 ? 'Лапа опущена. Проверьте суставы и сохраните позу.' : 'Лапа приближена к полу. Проверьте положение и при необходимости поправьте суставы.' } catch (e) { this.message.textContent = String((e as Error).message) }
    }), button('Сбросить правки позы', () => { this.calibration?.reset_working(); this.fields() }), this.message,
    button('Сохранить исходную позу', () => { this.calibration?.commit(); this.hide(); this.options.applied(); this.options.closed() }),
    button('Отмена', () => this.cancel()))
    container.append(this.element); new ResizeObserver(() => { if (this.open) { const r = this.element.getBoundingClientRect(); this.options.layout?.(r.width, r.height) } }).observe(this.element)
  }
  show(calibration: PoseCalibration, meshes: SkinnedMesh[]): void {
    this.calibration = calibration; calibration.begin(); this.select.replaceChildren()
    const bounds = new Box3(); meshes.forEach(mesh => bounds.union(new Box3().setFromObject(mesh, true))); const height = bounds.getSize(new Vector3()).y
    this.floor = bounds.isEmpty() ? 0 : bounds.min.y + height * 0.004
    const bones = calibration.bones.filter(b => !b.name.startsWith('rig_volume_'))
    for (const bone of bones) { const option = document.createElement('option'); option.value = bone.uuid; option.textContent = bone.name || 'Кость'; this.select.append(option) }
    this.selected = bones.filter(b => /(foot|toe|leaf|hoof|paw)/i.test(b.name) && /(front|back|leg|foot|toe|paw)/i.test(b.name)).sort((a, b) => b.getWorldPosition(new Vector3()).y - a.getWorldPosition(new Vector3()).y)[0] ?? bones[0]
    if (this.selected) this.select.value = this.selected.uuid
    this.fields(); this.message.textContent = 'Опорная поза: ' + calibration.reference_name + '. Изменения видны на модели.'; this.element.hidden = false
  }
  cancel(): void { if (!this.open) return; this.calibration?.cancel(); this.hide(); this.options.closed() }
  private hide(): void { this.element.hidden = true; this.options.layout?.(0, 0) }
  private fields(): void {
    if (!this.selected || !this.calibration) return
    const values = this.calibration.values(this.selected)
    for (const [inputs, numbers] of [[this.rotations, values.rotation], [this.positions, values.position]] as const) inputs.forEach((input, i) => { input.value = String(Number(numbers[i].toFixed(5))); (input.nextElementSibling as HTMLOutputElement).textContent = String(Number(numbers[i].toFixed(2))) })
  }
  private change(): void {
    if (!this.selected || !this.calibration) return
    const r = this.rotations.map(i => Number(i.value)), p = this.positions.map(i => Number(i.value)); if ([...r, ...p].some(v => !Number.isFinite(v))) return
    this.calibration.set(this.selected, r, p); this.fields()
  }
}
