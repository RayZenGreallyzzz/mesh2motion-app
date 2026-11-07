import type { RigAsset } from './RigAsset.ts'
import './native-rig.css'
import type { RigViewer } from './RigViewer.ts'
import { NativeRigClient, native_points, type NativePoints, type NativeReceipt } from './NativeRigClient.ts'

interface Options {
  viewer: RigViewer
  asset(): RigAsset | undefined
  operation(message: string, task: () => Promise<void>): Promise<void>
  show(bytes: ArrayBuffer): Promise<void>
  status?(message: string, error?: boolean): void
}
const names: Record<string, string> = { pelvis: 'Таз', chest: 'Грудная клетка', thorax: 'Грудная клетка', neck: 'Шея', head: 'Голова', shoulder: 'Плечо', elbow: 'Локоть', wrist: 'Запястье', hand_end: 'Конец кисти', hip: 'Бедро', knee: 'Колено', ankle: 'Голеностоп', ball: 'Основание пальцев стопы', toe: 'Носок' }
function title(name: string): string { const key = name.replace(/_[lr]$/, ''); return (names[key] ?? key) + (name.endsWith('_l') ? ' · слева' : name.endsWith('_r') ? ' · справа' : '') }

export class NativeRigPanel {
  private available = false
  private external_busy = false
  private busy = false
  private source?: ArrayBuffer
  private guides: NativePoints = {}
  private landmarks: NativePoints = {}
  private editing: 'guides' | 'landmarks' = 'guides'
  private preview_valid = false
  private front_seen = false
  private side_seen = false
  private readonly start: HTMLButtonElement
  private readonly propose: HTMLButtonElement
  private readonly preview: HTMLButtonElement
  private readonly build: HTMLButtonElement
  private readonly cancel: HTMLButtonElement
  private readonly front: HTMLButtonElement
  private readonly side: HTMLButtonElement
  private readonly review: HTMLInputElement
  private readonly message: HTMLParagraphElement
  private readonly editor: HTMLDivElement
  private readonly report: HTMLTextAreaElement
  private readonly fields = new Map<string, HTMLInputElement[]>()

  constructor(container: HTMLElement, private readonly options: Options, private readonly client = new NativeRigClient()) {
    const heading = document.createElement('h2'); heading.textContent = 'Нативный авториг · тест'
    const info = document.createElement('p'); info.className = 'hint'; info.textContent = 'Для человека в исходной T-позе. Сначала покажем ориентиры, затем проверьте суставы и посчитайте веса.'
    this.message = document.createElement('p'); this.message.setAttribute('role', 'status'); this.message.textContent = 'Проверяю доступность движка…'
    const button = (label: string, action: () => void): HTMLButtonElement => { const b = document.createElement('button'); b.textContent = label; b.onclick = action; return b }
    this.start = button('1. Найти ориентиры тела', () => void this.work('Ищу ориентиры тела…', () => this.initial()))
    this.propose = button('2. Подогнать суставы', () => void this.work('Подгоняю суставы…', () => this.proposal()))
    this.preview = button('3. Показать скелет', () => void this.work('Проверяю скелет…', () => this.body_preview()))
    const views = document.createElement('div'); views.className = 'native-rig-views'
    this.front = button('Спереди', () => { this.options.viewer.native_view(false); this.front_seen = true; this.refreshControls() })
    this.side = button('Сбоку', () => { this.options.viewer.native_view(true); this.side_seen = true; this.refreshControls() }); views.append(this.front, this.side)
    const label = document.createElement('label'); label.className = 'native-rig-review'
    this.review = document.createElement('input'); this.review.type = 'checkbox'; this.review.onchange = () => this.refreshControls()
    label.append(this.review, ' Проверил суставы спереди и сбоку')
    this.build = button('4. Рассчитать веса и открыть риг', () => void this.work('Рассчитываю веса…', () => this.skin()))
    this.cancel = button('Отменить расчёт', () => { void this.client.cancel().catch(error => this.set_message(String(error), true)) })
    this.editor = document.createElement('div'); this.editor.className = 'native-rig-points'
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Отчёт обработки'
    this.report = document.createElement('textarea'); this.report.readOnly = true; this.report.setAttribute('aria-label', 'Отчёт нативного риггера')
    const copy = button('Копировать отчёт', () => { void navigator.clipboard.writeText(this.report.value).then(() => this.set_message('Отчёт скопирован.'), () => this.set_message('Выделите текст отчёта и скопируйте вручную.')) })
    details.append(summary, this.report, copy)
    container.append(heading, info, this.start, this.propose, views, this.editor, this.preview, label, this.build, this.cancel, this.message, details)
    this.refreshControls()
    void this.client.available().then(result => { this.available = result.available; this.set_message(result.available ? 'Откройте GLB персонажа. Модель будет видна во время всех этапов.' : result.reason ?? 'Движок недоступен.'); this.refreshControls() }, () => this.set_message('Движок не подключён к этой сборке.'))
  }
  setAsset(asset: RigAsset): void {
    if (this.busy || this.source === asset.source_bytes) return
    this.source = asset.source_bytes; this.guides = {}; this.landmarks = {}; this.preview_valid = false; this.review.checked = false; this.front_seen = this.side_seen = false
    this.editor.replaceChildren(); this.fields.clear(); this.options.viewer.set_native_points({}); this.options.viewer.set_native_bones([])
    if (this.available) this.set_message('Персонаж открыт. Нажмите «Найти ориентиры тела».')
    void this.client.dispose(); this.refreshControls()
  }
  refreshControls(external_busy = this.external_busy): void {
    this.external_busy = external_busy
    const busy = this.busy || external_busy, has_guides = Object.keys(this.guides).length > 0, has_landmarks = Object.keys(this.landmarks).length > 0
    this.start.disabled = busy || !this.available || !this.options.asset()
    this.propose.disabled = busy || !has_guides
    this.preview.disabled = busy || !has_landmarks
    this.front.disabled = this.side.disabled = busy || !(has_guides || has_landmarks)
    this.review.disabled = busy || !this.preview_valid || !this.front_seen || !this.side_seen
    this.build.disabled = busy || !this.preview_valid || !this.review.checked || !has_landmarks
    this.cancel.hidden = !this.busy
    this.editor.querySelectorAll('input').forEach(input => { input.disabled = busy })
  }
  private set_message(text: string, error = false): void { this.message.textContent = text; this.message.classList.toggle('error', error); this.options.status?.(text, error) }
  private async work(message: string, action: () => Promise<void>): Promise<void> {
    if (this.busy || this.external_busy) return
    this.busy = true; this.refreshControls(); this.options.viewer.set_native_points(this.points())
    let listener: Awaited<ReturnType<NativeRigClient['listen']>> | undefined
    await this.options.operation(message, async () => {
      this.set_message(message)
      try {
        listener = await this.client.listen((stage, percent) => this.set_message(stage + ' · ' + percent + '%'))
        await action()
      } catch (error) { this.set_message(error instanceof Error ? error.message : String(error), true); throw error }
      finally {
        await listener?.remove(); this.report.value = JSON.stringify({ preparation: this.client.preparation, commands: this.client.receipts }, null, 2)
      }
    })
    this.busy = false; this.refreshControls(); this.markers()
  }
  private points(): NativePoints { return this.editing === 'guides' ? this.guides : this.landmarks }
  private markers(): void {
    this.options.viewer.set_native_points(this.points(), (name, point) => this.edit(name, point, false))
  }
  private edit(name: string, point: [number, number, number], redraw = true): void {
    this.points()[name] = point; this.preview_valid = false; this.review.checked = false; this.front_seen = this.side_seen = false
    if (this.editing === 'guides') this.landmarks = {}
    const fields = this.fields.get(name); fields?.forEach((input, i) => { input.value = String(Number(point[i].toFixed(5))) })
    this.options.viewer.set_native_bones([]); if (redraw) this.markers(); this.refreshControls()
  }
  private render_points(): void {
    this.editor.replaceChildren(); this.fields.clear()
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Перетаскивайте цветные точки на персонаже. Для глубины поверните вид сбоку.'; this.editor.append(hint)
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Координаты ориентиров'; details.append(summary)
    for (const [name, point] of Object.entries(this.points())) {
      const row = document.createElement('label'), caption = document.createElement('span'); caption.textContent = title(name); row.append(caption)
      const inputs = point.map((value, axis) => {
        const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(Number(value.toFixed(5))); input.setAttribute('aria-label', title(name) + ' ' + ['X', 'Y', 'Z'][axis])
        input.onchange = () => { const next = [...this.points()[name]] as [number, number, number]; const number = Number(input.value); if (!Number.isFinite(number) || Math.abs(number) > 1_000_000 || input.value.trim() === '') { input.value = String(next[axis]); return }; next[axis] = number; this.edit(name, next) }; row.append(input); return input
      })
      this.fields.set(name, inputs); details.append(row)
    }
    this.editor.append(details); this.markers()
  }
  private async initial(): Promise<void> {
    const asset = this.options.asset(); if (!asset) throw new Error('Откройте персонажа.')
    this.options.viewer.stop(); this.source = asset.source_bytes; this.guides = {}; this.landmarks = {}; this.preview_valid = false; this.review.checked = false; this.front_seen = this.side_seen = false
    await this.client.prepare(asset.source_bytes)
    const result = await this.client.run('INITIAL_BODY_GUIDES'); this.guides = native_points(result, 'points'); this.editing = 'guides'; this.render_points()
    this.set_message('Ориентиры показаны на модели. Проверьте их и нажмите «Подогнать суставы».')
  }
  private async proposal(): Promise<void> {
    const result = await this.client.run('PROPOSE_BODY', { bodyGuides: this.guides }); this.landmarks = native_points(result, 'landmarks'); this.editing = 'landmarks'; this.preview_valid = false; this.review.checked = false; this.front_seen = this.side_seen = false; this.render_points()
    this.set_message('Суставы показаны цветными точками. Поправьте их и нажмите «Показать скелет».')
  }
  private async body_preview(): Promise<void> {
    const result = await this.client.run('PREVIEW_BODY', { bodyLandmarks: this.landmarks })
    const roots = [result.nativeReport, result.nativeReturn]
    let bones: unknown
    for (const root of roots) { if (!root) continue; const preview = root.bodyPreview as Record<string, unknown> | undefined; const stats = root.stats as Record<string, unknown> | undefined; bones ??= preview?.bones ?? stats?.bones }
    if (!Array.isArray(bones) || !bones.length) throw new Error('Движок не вернул скелет для просмотра. Сохраните отчёт; исходная модель остаётся на экране.')
    this.options.viewer.set_native_bones(bones); this.preview_valid = true; this.review.checked = false
    this.set_message('Скелет показан на персонаже. Посмотрите спереди и сбоку, затем подтвердите суставы.')
  }
  private async skin(): Promise<void> {
    if (!this.preview_valid || !this.review.checked) throw new Error('Сначала проверьте скелет.')
    await this.client.run('BUILD_SKELETON', { bodyLandmarks: this.landmarks, reviewed: true })
    await this.client.run('COMPUTE_WEIGHTS')
    await this.client.run('EXPORT')
    const bytes = await this.client.result(); await this.options.show(bytes)
    this.guides = {}; this.landmarks = {}; this.preview_valid = false; this.review.checked = false; this.editor.replaceChildren(); this.options.viewer.set_native_points({}); this.options.viewer.set_native_bones([])
    this.set_message('Результат открыт. Включите «Кости» и добавьте анимацию из библиотеки, чтобы проверить деформации.')
  }
}
