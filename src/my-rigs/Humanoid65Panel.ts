import { dispose_rig_scene, type RigAsset } from './RigAsset.ts'
import type { RigViewer } from './RigViewer.ts'
import { build_humanoid65 } from './Humanoid65Builder.ts'
import { HumanoidHeadReviewRequired, type HeadLandmarks, type HeadPoint } from './HumanoidHeadReview.ts'

export async function humanoid_template(): Promise<ArrayBuffer> {
  const response = await fetch(new URL('../rigs/rig-human.glb', location.href))
  if (!response.ok) throw new Error('Полный человеческий шаблон недоступен')
  return response.arrayBuffer()
}
interface Options {
  viewer: RigViewer
  asset(): RigAsset | undefined
  operation(message: string, task: () => Promise<void>): Promise<void>
  show(bytes: ArrayBuffer): Promise<void>
  status(message: string, error?: boolean): void
  changed?(): void
}
const labels: Record<keyof HeadLandmarks, string> = { neck: 'Шея', head: 'Основание головы', head_end: 'Макушка' }

export class Humanoid65Panel {
  private busy = false
  private external = false
  private abort?: AbortController
  private points?: HeadLandmarks
  private owner?: ArrayBuffer
  private pending?: RigAsset
  private front_seen = false
  private side_seen = false
  private readonly build = document.createElement('button')
  private readonly manual = document.createElement('button')
  private readonly cancel = document.createElement('button')
  private readonly profile = document.createElement('select')
  private readonly review = document.createElement('section')
  private readonly coordinates = document.createElement('div')
  private readonly front = document.createElement('button')
  private readonly side = document.createElement('button')
  private readonly checked = document.createElement('input')
  private readonly confirm = document.createElement('button')
  private readonly dismiss = document.createElement('button')
  private readonly fields = new Map<keyof HeadLandmarks, HTMLInputElement[]>()

  constructor(container: HTMLElement, private readonly options: Options) {
    const title = document.createElement('h2'); title.textContent = 'Полный гуманоид · 65 костей'
    const info = document.createElement('p'); info.className = 'hint'; info.textContent = 'Тело, голова и все пальцы. Подгонка и новые веса для исходной T- или A-позы. Результат заменит открытый риг после успешной проверки.'
    const label = document.createElement('label'); label.textContent = 'Шаблон тела '; this.profile.setAttribute('aria-label', 'Шаблон полного гуманоидного рига'); this.profile.append(new Option('Человек / гуманоид', 'human'), new Option('Женский', 'woman')); label.append(this.profile)
    this.build.type = this.manual.type = this.cancel.type = 'button'
    this.build.className = 'primary'; this.build.textContent = 'Создать полный риг · 65 костей'; this.build.onclick = () => void this.run()
    this.manual.textContent = 'Уточнить голову вручную'; this.manual.onclick = () => void this.run(true)
    this.cancel.textContent = 'Отменить создание рига'; this.cancel.onclick = () => this.cancel_build()
    this.review.className = 'head-landmark-review'; this.review.setAttribute('aria-label', 'Ориентиры головы')
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Оранжевая точка — шея, голубая — основание черепа под челюстью, сиреневая — макушка без рогов и украшений. Перетаскивайте точки на модели. Для глубины используйте вид сбоку.'
    const views = document.createElement('div'); views.className = 'native-rig-views'
    this.front.textContent = 'Голова спереди'; this.side.textContent = 'Голова сбоку'
    this.front.onclick = () => this.view(false); this.side.onclick = () => this.view(true); views.append(this.front, this.side)
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Координаты головы'; details.append(summary, this.coordinates)
    const checked = document.createElement('label'); checked.className = 'native-rig-review'; this.checked.type = 'checkbox'; this.checked.onchange = () => this.refresh(); checked.append(this.checked, ' Проверил шею и голову спереди и сбоку')
    this.confirm.textContent = 'Продолжить с этой головой'; this.confirm.className = 'primary'; this.confirm.onclick = () => { if (!this.confirm.disabled) void this.run() }
    this.dismiss.textContent = 'Отменить уточнение головы'; this.dismiss.onclick = () => { this.clear_review(); this.options.viewer.fit(true); this.options.status('Уточнение отменено. Исходный персонаж сохранён.'); this.changed() }
    this.review.append(hint, views, details, checked, this.confirm, this.dismiss)
    container.append(title, info, label, this.build, this.manual, this.cancel, this.review); this.refresh()
  }
  get reviewing(): boolean { return !!this.points }
  start(): Promise<void> { return this.run() }
  cancel_build(): void { this.abort?.abort() }
  refresh(external = this.external): void {
    this.external = external
    if (this.owner && this.owner !== this.options.asset()?.source_bytes) this.clear_review()
    const locked = this.busy || external
    this.build.disabled = this.manual.disabled = locked || !this.options.asset() || this.reviewing
    this.profile.disabled = locked || this.reviewing
    this.cancel.hidden = !this.busy; this.review.hidden = !this.reviewing
    this.front.disabled = this.side.disabled = this.dismiss.disabled = locked
    this.checked.disabled = locked || !this.front_seen || !this.side_seen
    this.confirm.disabled = locked || !this.checked.checked || !this.front_seen || !this.side_seen
    this.coordinates.querySelectorAll('input').forEach(input => { input.disabled = locked })
  }
  private changed(): void { this.refresh(); this.options.changed?.() }
  private clear_review(markers = true): void {
    this.points = undefined; this.owner = undefined; this.front_seen = this.side_seen = this.checked.checked = false
    if (this.pending) {
      const original = this.options.asset(); if (original) this.options.viewer.set_asset(original)
      dispose_rig_scene(this.pending.scene); this.pending = undefined
    }
    if (markers) this.options.viewer.set_native_points({})
  }
  private view(side: boolean): void {
    if (!this.points) return
    this.options.viewer.native_view(side); this.options.viewer.focus_points(Object.values(this.points))
    if (side) this.side_seen = true; else this.front_seen = true
    this.refresh()
  }
  private edit(name: keyof HeadLandmarks, point: HeadPoint, redraw = true): void {
    if (!this.points) return
    this.points[name] = point; this.front_seen = this.side_seen = this.checked.checked = false
    this.fields.get(name)?.forEach((input, i) => { input.value = String(Number(point[i].toFixed(6))) })
    if (redraw) this.markers()
    this.refresh()
  }
  private markers(): void {
    if (!this.points) return
    // Native viewer markers use reflected-X RIG coordinates; solver uses GLB.
    const points: Record<string, HeadPoint> = {}
    for (const [name, p] of Object.entries(this.points)) points[name] = [-p[0], p[1], p[2]]
    this.options.viewer.set_native_points(points, (name, p) => { if (name in labels) this.edit(name as keyof HeadLandmarks, [-p[0], p[1], p[2]], false) })
  }
  private show_review(points: HeadLandmarks): void {
    this.points = structuredClone(points); this.owner = this.options.asset()?.source_bytes
    // Review the actual native output frame, even if its unit/origin differs
    // from the imported model. The editor's original asset remains uncommitted.
    if (this.pending) this.options.viewer.set_asset(this.pending)
    this.front_seen = this.side_seen = this.checked.checked = false; this.coordinates.replaceChildren(); this.fields.clear()
    for (const name of Object.keys(labels) as Array<keyof HeadLandmarks>) {
      const row = document.createElement('label'), caption = document.createElement('span'); caption.textContent = labels[name]; row.append(caption)
      const fields = points[name].map((value, axis) => {
        const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(Number(value.toFixed(6))); input.setAttribute('aria-label', labels[name] + ' ' + ['X', 'Y', 'Z'][axis])
        input.onchange = () => { if (!this.points) return; const p = [...this.points[name]] as HeadPoint, number = Number(input.value); if (!input.value.trim() || !Number.isFinite(number)) { input.value = String(p[axis]); return }; p[axis] = number; this.edit(name, p) }
        row.append(input); return input
      })
      this.fields.set(name, fields); this.coordinates.append(row)
    }
    this.options.viewer.set_native_bones([]); this.markers()
    this.options.status('Нужна проверка головы. Поправьте три точки спереди и сбоку и продолжите расчёт. Исходная модель остаётся на экране.')
    this.changed()
  }
  private async calculate(asset: RigAsset, forceReview = false): Promise<boolean> {
    try {
      const result = await build_humanoid65(asset, { template: await humanoid_template(), profile: this.profile.value as 'human' | 'woman', signal: this.abort!.signal, progress: text => this.options.status(text), head_landmarks: this.points, review_head: forceReview })
      this.clear_review(); await this.options.show(result.bytes)
      const fallback = result.report.joints.filter(j => (j.evidence as { source?: string })?.source === 'fallback').map(j => j.name.startsWith('lowerarm') ? 'локти' : 'колени')
      this.options.status('Готов полный риг: 65 костей, включая пальцы. ' + (fallback.length ? 'Проверьте ' + [...new Set(fallback)].join(' и ') + ': поверхность не дала точного ориентира, использованы пропорции шаблона. ' : '') + 'Проверьте движения перед экспортом.')
      return true
    } catch (error) {
      if (error instanceof HumanoidHeadReviewRequired) { this.show_review(error.points); return false }
      throw error
    }
  }
  private async run(forceReview = false): Promise<void> {
    const asset = this.pending ?? this.options.asset(); if (!asset || this.busy || this.external) return
    this.busy = true; this.abort = new AbortController(); this.options.viewer.stop(); this.changed()
    try { await this.options.operation('Подготавливаю полный гуманоидный риг…', async () => { await this.calculate(asset, forceReview) }) }
    finally { this.busy = false; this.abort = undefined; this.changed() }
  }
  /** Owns the freshly produced BODY23 until full completion or manual cancel.
   * Called inside the native operation, so it must not start a nested operation. */
  async complete_native(body: RigAsset): Promise<boolean> {
    this.clear_review(); this.pending = body; this.busy = true; this.abort = new AbortController(); this.changed()
    try { return await this.calculate(body) }
    catch (error) { this.clear_review(); throw error }
    finally { this.busy = false; this.abort = undefined; this.changed() }
  }
}
