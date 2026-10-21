import { ExportCancelledError, ExportFileSaver } from '../lib/processes/export-to-file/ExportFileSaver.ts'
import { MAX_GLB_BYTES } from './GlbEnvelope.ts'
import { dispose_rig_scene, type RigAsset } from './RigAsset.ts'
import { export_rig_asset, load_rig_asset } from './RigAssetLoader.ts'
import { RigLibrary } from './RigLibrary.ts'
import { animated_nodes, mapping_key, suggest_mapping, transfer_clips, type RigMapping } from './RigMotionTransfer.ts'
import { RigViewer } from './RigViewer.ts'

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id)
const library = new RigLibrary()
const viewer = new RigViewer(element('viewport'))
const dialog = element<HTMLDialogElement>('mapping-dialog')
let asset: RigAsset | undefined
let incoming: RigAsset | undefined
let mapping: RigMapping = {}
let selected_clip = -1
let busy = false
const status = (message: string, error = false): void => {
  element('status').textContent = message
  element('status').classList.toggle('error', error)
}

function controls (): void {
  for (const id of ['open-model', 'add-motion', 'save-library', 'export', 'rest', 'fit', 'pause']) {
    button(id).disabled = busy || (id !== 'open-model' && !asset) || (id === 'pause' && selected_clip < 0)
  }
  element<HTMLInputElement>('skeleton').disabled = !asset || busy
  element<HTMLInputElement>('timeline').disabled = selected_clip < 0 || busy
  element('library-list').querySelectorAll('button').forEach(item => { item.disabled = busy })
  document.body.classList.toggle('busy', busy)
}

async function operation (message: string, task: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  controls()
  status(message)
  try { await task() } catch (error) {
    if (error instanceof ExportCancelledError) status('Сохранение отменено. Можно повторить.')
    else status(error instanceof Error ? error.message : 'Не удалось выполнить действие', true)
  } finally { busy = false; controls() }
}

function show_asset (next: RigAsset): void {
  const previous = asset
  viewer.set_asset(next)
  asset = next
  if (previous) dispose_rig_scene(previous.scene)
  selected_clip = -1
  element('empty').hidden = true
  element('asset-info').hidden = false
  element('asset-name').textContent = asset.name
  element('asset-stats').textContent =
    asset.skeleton_count + ' скел. · ' + [...asset.nodes.values()].filter(node => node.is_joint).length +
    ' костей · ' + asset.vertex_count.toLocaleString('ru') + ' вершин'
  element<HTMLInputElement>('skeleton').checked = false
  button('pause').textContent = '▶'
  render_clips()
  show_tab(false)
  status(asset.skeleton_count ? 'Риг открыт. Родные веса и движения сохранены.' :
    'GLB открыт. В файле нет привязки кожи к скелету. Для создания рига вернитесь на главный экран.')
}

function render_clips (): void {
  const list = element('clips')
  list.replaceChildren()
  element('clip-count').textContent = String(asset?.clips.length ?? 0)
  if (!asset?.clips.length) {
    const empty = document.createElement('p')
    empty.className = 'placeholder'
    empty.textContent = asset ? 'В файле нет анимаций. Их можно добавить из другого GLB.' : 'Сначала откройте GLB.'
    list.append(empty)
  }
  asset?.clips.forEach((clip, index) => {
    const row = document.createElement('div')
    row.className = 'clip'
    row.dataset.index = String(index)
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.setAttribute('aria-label', 'Экспортировать ' + (clip.name || 'Движение ' + (index + 1)))
    checkbox.dataset.clip = String(index)
    const play = document.createElement('button')
    play.textContent = clip.name || 'Движение ' + (index + 1)
    const duration = document.createElement('small')
    duration.textContent = clip.duration.toFixed(2) + ' с · ' + clip.tracks.length + ' дорожек'
    play.append(duration)
    play.onclick = () => {
      if (busy) return
      viewer.play(index)
      selected_clip = index
      list.querySelectorAll('.clip').forEach(item => item.classList.toggle('selected', item === row))
      button('pause').textContent = 'Ⅱ'
      controls()
    }
    row.append(checkbox, play)
    list.append(row)
  })
}

function show_tab (is_library: boolean): void {
  element('library-panel').hidden = !is_library
  element('motions-panel').hidden = is_library
  for (const [id, active] of [['motions-tab', !is_library], ['library-tab', is_library]] as const) {
    button(id).classList.toggle('active', active)
    button(id).setAttribute('aria-pressed', String(active))
  }
}

async function render_library (): Promise<void> {
  const entries = await library.list()
  element('library-count').textContent = String(entries.length)
  const list = element('library-list')
  list.replaceChildren()
  if (!entries.length) {
    const empty = document.createElement('p')
    empty.className = 'placeholder'
    empty.textContent = 'Пока пусто. Откройте GLB и сохраните копию.'
    list.append(empty)
  }
  entries.forEach(entry => {
    const card = document.createElement('article')
    card.className = 'library-card'
    const title = document.createElement('h3')
    title.textContent = entry.title
    const meta = document.createElement('p')
    meta.textContent = entry.clip_count + ' движ. · ' + entry.bone_count + ' костей · ' +
      (entry.bytes / 1048576).toFixed(1) + ' МБ · ' + new Date(entry.created_at).toLocaleDateString('ru')
    const actions = document.createElement('div')
    const open = document.createElement('button'), remove = document.createElement('button')
    open.textContent = 'Открыть'
    remove.textContent = 'Удалить'
    open.onclick = () => void operation('Открываю сохранённый риг…', async () => {
      show_asset(await load_rig_asset(await library.read(entry.id), entry.title))
    })
    remove.onclick = () => {
      if (busy || !confirm('Удалить «' + entry.title + '» из библиотеки этого устройства?')) return
      void operation('Удаляю копию…', async () => {
        await library.remove(entry.id)
        await render_library()
        status('Копия удалена из библиотеки.')
      })
    }
    actions.append(open, remove)
    card.append(title, meta, actions)
    list.append(card)
  })
  controls()
}

function source_indices (): number[] {
  return [...element('source-clips').querySelectorAll<HTMLInputElement>('input:checked')].map(input => Number(input.value))
}

function render_mapping (): void {
  if (!incoming || !asset) return
  const list = element('mapping-rows')
  list.replaceChildren()
  for (const node of animated_nodes(incoming, source_indices())) {
    const row = document.createElement('div')
    row.className = 'map-row'
    const label = document.createElement('label'), select = document.createElement('select')
    select.id = 'map-' + node.id.replace(/\W/g, '-')
    select.dataset.source = node.id
    label.htmlFor = select.id
    label.textContent = node.name
    const parent = document.createElement('small')
    parent.textContent = node.parent_id ? '↳ ' + incoming.nodes.get(node.parent_id)!.name : 'Корневой узел'
    label.append(parent)
    select.add(new Option('— Выберите узел —', ''))
    asset.nodes.forEach(target => select.add(new Option(target.name + ' [' + target.id + ']', target.id)))
    select.value = mapping[node.id] ?? ''
    select.onchange = () => { mapping[node.id] = select.value; validate_mapping() }
    row.append(label, select)
    list.append(row)
  }
  validate_mapping()
}

function validate_mapping (): void {
  if (!incoming || !asset) return
  try {
    const clips = transfer_clips(incoming, asset, mapping, source_indices())
    element('mapping-status').textContent = 'Готово к добавлению: ' + clips.length + '.'
    element('mapping-status').classList.remove('error')
    button('apply-motion').disabled = false
  } catch (error) {
    element('mapping-status').textContent = (error as Error).message
    element('mapping-status').classList.add('error')
    button('apply-motion').disabled = true
  }
}

async function file_bytes (file: File): Promise<ArrayBuffer> {
  if (file.size > MAX_GLB_BYTES) throw new Error('GLB больше 128 МБ. Сначала уменьшите модель.')
  return file.arrayBuffer()
}

button('open-model').onclick = () => element<HTMLInputElement>('model-file').click()
element<HTMLInputElement>('model-file').onchange = event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (file) void operation('Читаю GLB…', async () => show_asset(await load_rig_asset(await file_bytes(file), file.name)))
}
button('add-motion').onclick = () => element<HTMLInputElement>('motion-file').click()
element<HTMLInputElement>('motion-file').onchange = event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || !asset) return
  void operation('Проверяю файл анимаций…', async () => {
    incoming = await load_rig_asset(await file_bytes(file), file.name)
    if (!incoming.clips.length) { dispose_rig_scene(incoming.scene); incoming = undefined; throw new Error('В этом GLB нет анимаций') }
    mapping = suggest_mapping(incoming, asset!)
    try { mapping = await library.get_mapping(mapping_key(incoming, asset!)) ?? mapping } catch { /* mapping is optional */ }
    const list = element('source-clips')
    list.replaceChildren()
    incoming.clips.forEach((clip, index) => {
      const label = document.createElement('label'), checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = true
      checkbox.value = String(index)
      checkbox.onchange = render_mapping
      label.append(checkbox, document.createTextNode(clip.name || 'Движение ' + (index + 1)))
      list.append(label)
    })
    render_mapping()
    dialog.showModal()
    status('Файл прочитан. Проверьте соответствия в окне добавления.')
  })
}
dialog.addEventListener('close', () => {
  if (incoming) dispose_rig_scene(incoming.scene)
  incoming = undefined
})
button('apply-motion').onclick = () => {
  if (!incoming || !asset) return
  // Build all clips before modifying the target. One invalid track rejects the whole import.
  let clips
  try { clips = transfer_clips(incoming, asset, mapping, source_indices()) } catch (error) {
    element('mapping-status').textContent = (error as Error).message
    return
  }
  const key = mapping_key(incoming, asset), saved_mapping = { ...mapping }
  asset.clips.push(...clips)
  asset.dirty = true
  viewer.stop()
  selected_clip = -1
  button('pause').textContent = '▶'
  render_clips()
  dialog.close()
  controls()
  status('Добавлено движений: ' + clips.length + '. Сохраните копию или экспортируйте GLB.')
  void library.save_mapping(key, saved_mapping).catch(() => {
    status('Движения добавлены. Соответствия не удалось сохранить; экспорт GLB доступен.')
  })
}
button('save-library').onclick = () => void operation('Сохраняю риг и все движения…', async () => {
  const current = asset!
  const bytes = current.dirty ? await export_rig_asset(current) : current.source_bytes
  await library.save({
    id: crypto.randomUUID(), title: current.name, created_at: Date.now(), bytes: bytes.byteLength,
    clip_count: current.clips.length, bone_count: [...current.nodes.values()].filter(node => node.is_joint).length,
    skeleton_count: current.skeleton_count
  }, bytes)
  await render_library()
  status('Копия сохранена. Её можно открыть в библиотеке после перезапуска.')
})
button('export').onclick = () => void operation('Подготавливаю GLB…', async () => {
  const indices = [...element('clips').querySelectorAll<HTMLInputElement>('input:checked')].map(input => Number(input.dataset.clip))
  const bytes = await export_rig_asset(asset!, indices)
  const filename = asset!.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'my-rig'
  await new ExportFileSaver().save(new Blob([bytes], { type: 'model/gltf-binary' }), filename + '.glb')
  status('GLB сохранён: ' + indices.length + ' движений.')
})
button('rest').onclick = () => {
  viewer.stop()
  selected_clip = -1
  button('pause').textContent = '▶'
  element('clips').querySelectorAll('.clip').forEach(row => row.classList.remove('selected'))
  controls()
}
button('fit').onclick = () => viewer.fit()
button('pause').onclick = () => { button('pause').textContent = viewer.toggle_pause() ? 'Ⅱ' : '▶' }
element<HTMLInputElement>('skeleton').onchange = event => viewer.show_skeleton((event.target as HTMLInputElement).checked)
element<HTMLSelectElement>('speed').onchange = event => viewer.set_speed(Number((event.target as HTMLSelectElement).value))
element<HTMLInputElement>('timeline').oninput = event => viewer.seek(Number((event.target as HTMLInputElement).value))
viewer.on_time = (time, duration) => {
  element<HTMLInputElement>('timeline').max = String(duration || 1)
  element<HTMLInputElement>('timeline').value = String(time)
  element('time').textContent = time.toFixed(2) + ' с'
}
button('motions-tab').onclick = () => show_tab(false)
button('library-tab').onclick = () => show_tab(true)
void render_library().catch(() => status('Хранилище устройства недоступно. Можно открыть GLB и экспортировать результат.', true))
controls()
