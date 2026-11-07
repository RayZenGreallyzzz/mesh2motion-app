import type { RigViewer } from './RigViewer.ts'
import './studio-workspace.css'

type Panel = 'file' | 'native' | 'motions' | 'library' | 'view'

/** Full-screen stage with settings opened only through explicit toolbar buttons. */
export class StudioWorkspace {
  private active?: Panel
  private readonly panels = new Map<Panel, HTMLElement>()
  private readonly buttons = new Map<Panel, HTMLButtonElement>()
  private readonly toolbar = document.createElement('nav')
  constructor(private readonly viewer: RigViewer, private readonly show_tab: (library: boolean) => void) {
    document.body.classList.add('room-workspace')
    this.toolbar.className = 'studio-toolbar'; this.toolbar.setAttribute('aria-label', 'Вкладки студии')
    const layer = document.createElement('div'); layer.className = 'workspace-layer'
    const pane = (key: Panel, label: string, button_text: string): HTMLElement => {
      const button = document.createElement('button'); button.textContent = button_text; button.dataset.panel = key; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'workspace-' + key); button.onclick = () => this.active === key ? this.close() : this.open(key)
      this.toolbar.append(button); this.buttons.set(key, button)
      const panel = document.createElement('section'); panel.id = 'workspace-' + key; panel.className = 'workspace-dialog'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label)
      const header = document.createElement('div'); header.className = 'workspace-dialog-heading'; const heading = document.createElement('h2'); heading.textContent = label
      const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть ' + label); close.onclick = () => this.close(); header.append(heading, close); panel.append(header); layer.append(panel); this.panels.set(key, panel)
      return panel
    }
    const file = pane('file', 'Файл и персонаж', 'Файл')
    document.querySelectorAll('.import-row').forEach(row => file.append(row)); file.append(document.getElementById('asset-info')!)
    const rig = pane('native', 'Создать риг', 'Риг')
    rig.append(document.getElementById('initial-pose')!, document.getElementById('native-rig-panel')!)
    const animals = document.createElement('a'); animals.href = '../create.html'; animals.className = 'workspace-link'; animals.textContent = 'Шаблоны животных и монстров →'; rig.append(animals)
    const motions = pane('motions', 'Анимации', 'Анимации')
    const speed = document.createElement('label'); speed.className = 'workspace-speed'; speed.append('Скорость воспроизведения ', document.getElementById('speed')!); motions.append(speed, document.getElementById('motion-preview')!, document.getElementById('motions-panel')!)
    pane('library', 'Библиотека', 'Библиотека').append(document.getElementById('library-panel')!)
    const view = pane('view', 'Комната и просмотр', 'Вид')
    const room_label = document.createElement('label'); room_label.className = 'toggle'; const room = document.createElement('input'); room.id = 'room-enabled'; room.type = 'checkbox'; room.checked = true; room.onchange = () => viewer.set_room_enabled(room.checked); room_label.append(room, 'Комната')
    const grid_label = document.createElement('label'); grid_label.className = 'toggle'; const grid = document.createElement('input'); grid.id = 'room-grid'; grid.type = 'checkbox'; grid.onchange = () => viewer.set_grid_visible(grid.checked); grid_label.append(grid, 'Сетка на полу')
    view.append(room_label, grid_label, document.querySelector('.stage-tools')!)
    const help = document.createElement('p'); help.className = 'hint'; help.textContent = 'Один палец — вращение вокруг персонажа. Два пальца — приближение и перемещение вида.'; view.append(help)
    const status = document.getElementById('status')!; status.classList.add('workspace-status'); document.querySelector('.stage')!.append(status)
    const aside = document.querySelector('aside')!; aside.hidden = true; document.body.append(this.toolbar, layer)
    const observer = new ResizeObserver(() => this.update_overlay()); for (const panel of this.panels.values()) observer.observe(panel)
    window.addEventListener('resize', () => this.update_overlay())
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.active && !(event.target as HTMLElement).closest('dialog[open]')) { event.preventDefault(); this.close() } })
    document.addEventListener('click', event => { if (this.active && !(event.target as HTMLElement).closest('.workspace-dialog, .studio-toolbar, .pose-editor-panel, dialog')) this.close(false) })
  }
  open(key: Panel): void {
    this.active = key
    if (key === 'motions' || key === 'library') this.show_tab(key === 'library')
    for (const [name, panel] of this.panels) panel.hidden = name !== key
    for (const [name, button] of this.buttons) { button.setAttribute('aria-expanded', String(name === key)); button.classList.toggle('active', name === key) }
    this.update_overlay()
  }
  close(focus = true): void {
    const old = this.active; this.active = undefined; for (const panel of this.panels.values()) panel.hidden = true
    for (const button of this.buttons.values()) { button.setAttribute('aria-expanded', 'false'); button.classList.remove('active') }
    this.viewer.set_settings_overlay(0, 0, false); if (focus && old) this.buttons.get(old)?.focus()
  }
  sync_tab(library: boolean): void { if (this.active === 'motions' && library) this.open('library'); else if (this.active === 'library' && !library) this.open('motions') }
  private update_overlay(): void {
    if (!this.active) return
    const panel = this.panels.get(this.active)!, rect = panel.getBoundingClientRect(), bottom = window.innerWidth <= 620
    if (rect.width && rect.height) this.viewer.set_settings_overlay(rect.width + 32, rect.height + 104, bottom)
  }
}
