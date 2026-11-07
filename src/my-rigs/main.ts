import type { AnimationClip } from 'three'
import { ordered_nodes, is_volume_node, mapping_family_key } from './RigBoneMapping.ts'
import '../library/pack-style.css';
import { mount_catalog } from '../library/Catalog.ts'
import { show_motion_import } from './MotionImportDialog.ts'
import { MotionLibrary, type MotionEntry } from './MotionLibrary.ts'
import { MotionImportClient } from './MotionImportClient.ts'
import { asset_from_motion } from './MotionDocument.ts'
import { input_format } from './MotionArchive.ts'
import { ExportCancelledError, ExportFileSaver } from '../lib/processes/export-to-file/ExportFileSaver.ts'
import { MAX_GLB_BYTES } from './GlbEnvelope.ts'
import { dispose_rig_scene, type RigAsset } from './RigAsset.ts'
import { export_rig_asset, load_rig_asset } from './RigAssetLoader.ts'
import { RigLibrary, type LibraryEntry } from './RigLibrary.ts'
import { inspect_transfer, mapping_key, suggest_mapping, transfer_clips_async, type TransferOptions, type RigMapping } from './RigMotionTransfer.ts'
import { RigViewer } from './RigViewer.ts'
import { inspect_skin_weights } from './RigSkinDiagnostics.ts'
import { NativeRigPanel } from './NativeRigPanel.ts'
import { validate_native_skin } from './NativeRigValidation.ts'

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id)
const library = new RigLibrary(), motions = new MotionLibrary()
type ShelfEntry = (LibraryEntry & { format: 'glb' }) | MotionEntry
let shelf: ShelfEntry[] = [], library_page = 0
const viewer = new RigViewer(element('viewport'))
const dialog = element<HTMLDialogElement>('mapping-dialog')
let asset: RigAsset | undefined
let incoming: RigAsset | undefined
let mapping: RigMapping = {}
let selected_clip = -1
let busy = false
let native_panel: NativeRigPanel | undefined
const status = (message: string, error = false): void => {
  element('status').textContent = message
  element('status').classList.toggle('error', error)
}

function controls (): void {
  for (const id of ['open-model', 'import-pack', 'add-motion', 'motion-library', 'save-library', 'export', 'rest', 'fit', 'pause']) {
    button(id).disabled = busy || (!['open-model', 'import-pack'].includes(id) && !asset) || (id === 'pause' && selected_clip === -1)
  }
  element<HTMLInputElement>('skeleton').disabled = !asset || busy
  element<HTMLInputElement>('follow').disabled = !asset || busy
  element<HTMLInputElement>('timeline').disabled = selected_clip === -1 || busy
  element('library-panel').querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(item => { item.disabled = busy || item.dataset.unavailable === 'true' })
  element('library-panel').querySelectorAll<HTMLButtonElement>('button[data-motion]').forEach(item => { item.disabled = busy || !asset?.skeleton_count })
  dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(item => { item.disabled = busy })
  element('motion-preview').querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = busy })
  document.body.classList.toggle('busy', busy)
  native_panel?.refreshControls(busy)
}

async function operation (message: string, task: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  controls()
  status(message)
  try { await task() } catch (error) {
    if (error instanceof ExportCancelledError) status('Сохранение отменено. Можно повторить.')
    else status(error instanceof Error ? error.message : 'Не удалось выполнить действие', true)
  } finally { busy = false; controls(); if (incoming && dialog.open) validate_mapping() }
}

function show_asset (next: RigAsset): void {
  if (incoming) cancel_transfer()
  const previous = asset
  viewer.set_asset(next)
  asset = next
  native_panel?.setAsset(next)
  if (previous) dispose_rig_scene(previous.scene)
  selected_clip = -1
  element('empty').hidden = true
  element('asset-info').hidden = false
  element('asset-name').textContent = asset.name
  element('asset-stats').textContent =
    asset.skeleton_count + ' скел. · ' + [...asset.nodes.values()].filter(node => node.is_joint).length +
    ' костей · ' + asset.vertex_count.toLocaleString('ru') + ' вершин'
  const skin = inspect_skin_weights(asset), warning = element('skin-warning')
  warning.hidden = skin.cross_limb_vertices === 0
  warning.textContent = 'Проверьте веса: у ' + skin.cross_limb_vertices.toLocaleString('ru') + ' вершин одновременно есть влияние рук и ног. При движении возможны растяжения сетки. Перенос анимации сохраняет эти веса.'
  element<HTMLInputElement>('skeleton').checked = false
  button('pause').textContent = '▶'
  render_clips()
  show_tab(false)
  status(asset.skeleton_count ? 'Риг открыт. Родные веса и движения сохранены.' :
    'GLB открыт. Для человека доступен тест нативного авторига ниже; другие шаблоны — на главном экране.')
}

native_panel = new NativeRigPanel(element('native-rig-panel'), {
  viewer,
  asset: () => asset,
  operation,
  show: async bytes => {
    const next = await load_rig_asset(bytes, (asset?.name ?? 'Персонаж') + ' · нативный риг')
    try { validate_native_skin(next) } catch (error) { dispose_rig_scene(next.scene); throw error }
    show_asset(next); element<HTMLInputElement>('skeleton').checked = true; viewer.show_skeleton(true)
  }
})

function render_clips (): void {
  const list = element('clips')
  list.replaceChildren()
  element('clip-count').textContent = String(asset?.clips.length ?? 0)
  if (!asset?.clips.length) {
    const empty = document.createElement('p')
    empty.className = 'placeholder'
    empty.textContent = asset ? 'В файле нет анимаций. Их можно добавить из BVH, FBX или GLB.' : 'Сначала откройте GLB.'
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
  const [models, imported] = await Promise.all([library.list(), motions.list()])
  shelf = [...models.map(e => ({ ...e, format: 'glb' as const })), ...imported].sort((a, b) => b.created_at - a.created_at || a.title.localeCompare(b.title))
  element('library-count').textContent = String(shelf.length)
  const packs = element<HTMLSelectElement>('library-pack'), previous = packs.value
  packs.replaceChildren(new Option('Все наборы', ''))
  for (const pack of [...new Set(shelf.map(e => e.source_pack).filter(Boolean))].sort()) packs.add(new Option(pack, pack))
  if ([...packs.options].some(o => o.value === previous)) packs.value = previous
  paint_library()
}
function paint_library (): void {
  const query = element<HTMLInputElement>('library-search').value.trim().toLocaleLowerCase(), format = element<HTMLSelectElement>('library-format').value, pack = element<HTMLSelectElement>('library-pack').value
  const matches = shelf.filter(e => (!format || e.format === format) && (!pack || e.source_pack === pack) && [e.title, e.source_path, e.source_pack, ...('clip_names' in e ? e.clip_names : [])].join(' ').toLocaleLowerCase().includes(query))
  const pages = Math.max(1, Math.ceil(matches.length / 30)); library_page = Math.min(library_page, pages - 1)
  element('library-summary').textContent = 'Найдено: ' + matches.length + ' файлов · ' + matches.reduce((sum, e) => sum + e.clip_count, 0) + ' движений'
  element('library-page').textContent = (library_page + 1) + ' / ' + pages
  button('library-prev').dataset.unavailable = String(library_page === 0); button('library-next').dataset.unavailable = String(library_page + 1 >= pages)
  const list = element('library-list'); list.replaceChildren()
  if (!matches.length) { const empty = document.createElement('p'); empty.className = 'placeholder'; empty.textContent = shelf.length ? 'По этим условиям ничего не найдено.' : 'Добавьте ZIP, BVH, FBX или GLB. Записи останутся на этом устройстве.'; list.append(empty) }
  for (const entry of matches.slice(library_page * 30, library_page * 30 + 30)) {
    const card = document.createElement('article'); card.className = 'library-card'
    const title = document.createElement('h3'); title.textContent = entry.title
    const meta = document.createElement('p'); meta.textContent = entry.format.toUpperCase() + ' · ' + entry.clip_count + ' движ. · ' + entry.bone_count + ' костей · ' + (entry.bytes / 1048576).toFixed(1) + ' МБ'
    const origin = document.createElement('p'); origin.className = 'library-origin'; origin.textContent = [entry.source_pack, entry.source_path].filter(Boolean).join(' / ')
    const actions = document.createElement('div'), remove = document.createElement('button'); remove.textContent = 'Удалить'
    remove.onclick = () => {
      if (busy || !confirm('Удалить «' + entry.title + '» из библиотеки этого устройства?')) return
      void operation('Удаляю копию…', async () => { await (entry.format === 'glb' ? library : motions).remove(entry.id); await render_library(); status('Копия удалена из библиотеки.') })
    }
    if (entry.format === 'glb') {
      const open = document.createElement('button'); open.textContent = 'Открыть'
      open.onclick = () => void operation('Открываю сохранённый риг…', async () => show_asset(await load_rig_asset(await library.read(entry.id), entry.title)))
      const use = document.createElement('a'); use.className = 'catalog-link'; use.textContent = entry.skeleton_count ? 'Выбрать скелет' : 'Создать риг'
      use.href = '../create.html?' + (entry.skeleton_count ? 'rig=' + encodeURIComponent('library:' + entry.id) : 'library=' + encodeURIComponent(entry.id)); actions.append(open, use)
    }
    if (entry.clip_count) {
      const take = document.createElement('button'); take.textContent = 'Взять движения'; take.dataset.motion = 'true'
      take.onclick = () => { if (!asset || busy) return; void operation('Читаю выбранные движения…', async () => { await open_motion_source(entry.format === 'glb' ? await load_rig_asset(await library.read(entry.id), entry.title) : asset_from_motion(await motions.read(entry.id))) }) }; actions.append(take)
    }
    if (entry.format !== 'glb') {
      const rename = document.createElement('button'); rename.textContent = 'Название'
      rename.onclick = () => { if (busy) return; const title = prompt('Название набора движений', entry.title); if (title?.trim()) void operation('Сохраняю название…', async () => { await motions.rename(entry.id, title); await render_library(); status('Название сохранено.') }) }; actions.append(rename)
    }
    actions.append(remove); card.append(title, meta, origin, actions); list.append(card)
  }
  controls()
}
for (const id of ['library-search', 'library-format', 'library-pack']) element(id).addEventListener(id === 'library-search' ? 'input' : 'change', () => { library_page = 0; paint_library() })
button('library-prev').onclick = () => { library_page--; paint_library() }; button('library-next').onclick = () => { library_page++; paint_library() }

function source_indices (): number[] {
  return [...element('source-clips').querySelectorAll<HTMLInputElement>('input:checked')].map(input => Number(input.value))
}

function transfer_options (): TransferOptions {
  return { deformation: element<HTMLInputElement>('deformation-motion').checked, skip_first_frame: incoming?.motion_info?.format === 'bvh' && element<HTMLInputElement>('skip-first-frame').checked, match_pose: element<HTMLInputElement>('match-pose').checked, in_place: element<HTMLSelectElement>('root-motion').value === 'in-place', anchor_motion: element<HTMLInputElement>('anchor-motion').checked }
}
function render_mapping (): void {
  if (!incoming || !asset) return
  const list = element('mapping-rows'); list.replaceChildren()
  for (const node of ordered_nodes(incoming).filter(node => node.is_joint && !is_volume_node(node))) {
    const row = document.createElement('div'); row.className = 'map-row'
    const label = document.createElement('label'), select = document.createElement('select')
    select.id = 'map-' + node.id.replace(/\W/g, '-'); select.dataset.source = node.id; label.htmlFor = select.id; label.textContent = node.name
    const parent = document.createElement('small'); parent.textContent = node.parent_id ? '↳ ' + incoming.nodes.get(node.parent_id)!.name : 'Корневая кость'; label.append(parent)
    select.add(new Option('— Пропустить —', ''))
    asset.nodes.forEach(target => { if (target.is_joint && !is_volume_node(target)) select.add(new Option(target.name, target.id)) })
    select.value = mapping[node.id] ?? ''; select.onchange = () => { mapping[node.id] = select.value; validate_mapping() }
    row.append(label, select); list.append(row)
  }
  const choice = element<HTMLSelectElement>('preview-clip'), previous = choice.value; choice.replaceChildren()
  for (const index of source_indices()) choice.add(new Option(incoming.clips[index].name || 'Движение ' + (index + 1), String(index)))
  if ([...choice.options].some(o => o.value === previous)) choice.value = previous
  validate_mapping()
}
function validate_mapping (): void {
  if (!incoming || !asset) return
  element('mapping-summary').textContent = [...incoming.nodes.values()].filter(n => n.is_joint).length + ' → ' + [...asset.nodes.values()].filter(n => n.is_joint).length + ' костей'
  try {
    const report = inspect_transfer(incoming, asset, mapping, source_indices(), transfer_options())
    element('mapping-summary').textContent = report.source_bones + ' → ' + report.target_bones + ' костей · сопоставлено ' + report.mapped_bones
    element('mapping-status').textContent = report.exact ? 'Совместимый риг: сохраняются все дорожки.' : 'Скелет и веса персонажа сохраняются. Дополнительных костей: ' + report.retained_target.length + '. Масштаб перемещения: ' + report.scale.toFixed(2) + '. ' + report.warnings.join(' ')
    element('mapping-status').classList.remove('error'); button('apply-motion').disabled = busy; button('preview-motion').disabled = busy
  } catch (error) {
    element('mapping-status').textContent = (error as Error).message; element('mapping-status').classList.add('error'); button('apply-motion').disabled = true; button('preview-motion').disabled = true
  }
}
async function open_motion_source (next: RigAsset): Promise<void> {
  if (!asset) { dispose_rig_scene(next.scene); throw new Error('Сначала откройте персонажа с готовым ригом') }
  if (!next.clips.length) { dispose_rig_scene(next.scene); throw new Error('В этом файле нет анимаций') }
  if (incoming) dispose_rig_scene(incoming.scene)
  incoming = next; element<HTMLInputElement>('deformation-motion').checked = false; viewer.stop(); selected_clip = -1; button('pause').textContent = '▶'; element('motion-preview').hidden = true
  mapping = suggest_mapping(incoming, asset)
  try { mapping = await library.get_mapping(mapping_key(incoming, asset)) ?? await library.get_mapping(mapping_family_key(incoming, asset)) ?? mapping } catch { /* optional cache */ }
  element('mapping-source').textContent = incoming.name + ' → ' + asset.name
  element('calibration-option').hidden = incoming.motion_info?.format !== 'bvh'
  element<HTMLInputElement>('skip-first-frame').checked = Boolean(incoming.motion_info?.calibration_frame)
  element('source-warning').textContent = [...(incoming.motion_info?.warnings ?? []), ...(incoming.motion_info?.calibration_frame ? ['Первый кадр похож на калибровочную позу. Он будет пропущен только при переносе; можно отключить ниже.'] : [])].join(' ')
  const list = element('source-clips'); list.replaceChildren()
  incoming.clips.forEach((clip, index) => {
    const label = document.createElement('label'), checkbox = document.createElement('input')
    checkbox.type = 'checkbox'; checkbox.checked = index === 0; checkbox.value = String(index); checkbox.onchange = render_mapping
    label.append(checkbox, document.createTextNode((clip.name || 'Движение ' + (index + 1)) + ' · ' + clip.duration.toFixed(1) + ' с')); list.append(label)
  })
  render_mapping(); dialog.returnValue = ''; dialog.showModal(); status('Выберите движения и проверьте их на своём персонаже перед добавлением.')
}
function cancel_transfer (): void {
  viewer.stop(); selected_clip = -1; button('pause').textContent = '▶'; element('motion-preview').hidden = true
  if (incoming) dispose_rig_scene(incoming.scene)
  incoming = undefined; controls()
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
button('motion-library').onclick = () => { show_tab(true); status('Персонаж остаётся открытым. Найдите набор и нажмите «Взять движения». ZIP можно сначала добавить в библиотеку.') }
element<HTMLInputElement>('motion-file').onchange = event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || !asset) return
  void operation('Читаю источник анимаций…', async () => { const format = input_format(file.name)
    if (!format) throw new Error('Выберите BVH, FBX или GLB')
    if (format === 'glb') { await open_motion_source(await load_rig_asset(await file_bytes(file), file.name)); return }
    const client = new MotionImportClient(); viewer.set_suspended(true)
    try { const result = await client.read({ blob: file, name: file.name, format, size: file.size }); if (result.kind === 'motion') await open_motion_source(asset_from_motion(result.document)) } finally { client.close(); viewer.set_suspended(false) } })
}
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
dialog.addEventListener('close', () => { if (dialog.returnValue !== 'preview') cancel_transfer() })
element('deformation-motion').onchange = validate_mapping; element('match-pose').onchange = validate_mapping; element('root-motion').onchange = validate_mapping
element('anchor-motion').onchange = validate_mapping; element('skip-first-frame').onchange = validate_mapping
for (const [id, checked] of [['clips-all', true], ['clips-none', false]] as const) button(id).onclick = () => { element('source-clips').querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = checked }); render_mapping() }
button('auto-map').onclick = () => { if (incoming && asset) { mapping = suggest_mapping(incoming, asset); render_mapping() } }
button('preview-motion').onclick = () => {
  if (!incoming || !asset) return
  const source = incoming, target = asset, index = Number(element<HTMLSelectElement>('preview-clip').value)
  if (!source_indices().includes(index)) return
  void operation('Готовлю предпросмотр…', async () => {
    const clips = await transfer_clips_async(source, target, mapping, [index], transfer_options())
    dialog.close('preview'); show_tab(false); element('motion-preview').hidden = false; element('preview-name').textContent = source.clips[index].name
    viewer.play_clip(clips[0]); selected_clip = -2; button('pause').textContent = 'Ⅱ'; status('Предпросмотр на вашем персонаже. Движение ещё не добавлено; можно поправить соответствия.')
  })
}
button('edit-preview').onclick = () => { viewer.stop(); selected_clip = -1; dialog.returnValue = ''; dialog.showModal(); controls(); validate_mapping() }
button('cancel-preview').onclick = () => { cancel_transfer(); status('Предпросмотр закрыт. Исходные движения сохранены.') }
async function apply_motion (): Promise<void> {
  if (!incoming || !asset || busy) return
  const source = incoming, target = asset, indices = source_indices(), options = transfer_options(), saved_mapping = { ...mapping }
  await operation('Переношу движения…', async () => {
    const clips: AnimationClip[] = await transfer_clips_async(source, target, saved_mapping, indices, options, (done, total) => { const message = 'Перенос движений: ' + done + ' из ' + total; status(message); element('mapping-status').textContent = message })
    // Commit only once every requested clip has been baked successfully.
    const key = mapping_key(source, target), family = mapping_family_key(source, target)
    viewer.stop(); target.clips.push(...clips); target.dirty = true; selected_clip = -1; button('pause').textContent = '▶'; render_clips(); show_tab(false)
    if (dialog.open) { dialog.returnValue = ''; dialog.close() } else cancel_transfer()
    status('Добавлено движений: ' + clips.length + '. Скелет и веса сохранены. Экспортируйте GLB или сохраните копию.')
    await library.save_mapping(key, saved_mapping).catch(() => {})
    await library.save_mapping(family, saved_mapping).catch(() => {})
  })
}
button('apply-motion').onclick = () => void apply_motion(); button('apply-preview').onclick = () => void apply_motion()
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
element<HTMLInputElement>('follow').onchange = event => viewer.set_follow((event.target as HTMLInputElement).checked)
element<HTMLSelectElement>('speed').onchange = event => viewer.set_speed(Number((event.target as HTMLSelectElement).value))
element<HTMLInputElement>('timeline').oninput = event => viewer.seek(Number((event.target as HTMLInputElement).value))
viewer.on_time = (time, duration) => {
  element<HTMLInputElement>('timeline').max = String(duration || 1)
  element<HTMLInputElement>('timeline').value = String(time)
  element('time').textContent = time.toFixed(2) + ' с'
}
button('motions-tab').onclick = () => show_tab(false)
button('library-tab').onclick = () => show_tab(true)
mount_catalog(element('builtin-catalog'), (path, title) => void operation('Открываю встроенный набор…', async () => {
  const response = await fetch(new URL('/' + path, location.href))
  if (!response.ok) throw new Error('Набор недоступен')
  show_asset(await load_rig_asset(await response.arrayBuffer(), title))
}), (path, title) => {
  if (!asset || busy) return
  void operation('Читаю движения встроенного набора…', async () => {
    const response = await fetch(new URL('/' + path, location.href)); if (!response.ok) throw new Error('Набор недоступен')
    await open_motion_source(await load_rig_asset(await response.arrayBuffer(), title))
  })
}, () => Boolean(asset?.skeleton_count) && !busy)
button('import-pack').onclick = () => element<HTMLInputElement>('pack-file').click()
element<HTMLInputElement>('pack-file').onchange = event => {
  const input = event.target as HTMLInputElement, files = [...(input.files ?? [])]; input.value = ''
  if (!files.length) return
  void operation('Читаю список файлов…', async () => {
    viewer.set_suspended(true)
    try { await show_motion_import(files, motions, library, message => status(message)) }
    finally { viewer.set_suspended(false); await render_library(); show_tab(true) }
    status('Библиотека обновлена. Выберите набор и нажмите «Взять движения».')
  })
}
if (new URLSearchParams(location.search).get('tab') === 'library') show_tab(true)
if (new URLSearchParams(location.search).get('native') === '1') void operation('Открываю пример персонажа…', async () => {
  const response = await fetch(new URL('../models/model-human.glb', location.href))
  if (!response.ok) throw new Error('Пример модели недоступен. Откройте свой GLB.')
  show_asset(await load_rig_asset(await response.arrayBuffer(), 'Пример человека'))
})
void render_library().catch(() => status('Хранилище устройства недоступно. Можно открыть GLB и экспортировать результат.', true))
controls()

