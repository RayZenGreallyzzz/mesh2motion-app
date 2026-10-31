import { archive_input, input_format, input_limit, open_motion_archive, type InputFormat, type MotionInput } from './MotionArchive.ts'
import { MotionImportClient } from './MotionImportClient.ts'
import { MotionLibrary } from './MotionLibrary.ts'
import { RigLibrary } from './RigLibrary.ts'

interface Job { name: string, pack: string, path: string, size: number, format: InputFormat, key?: string, input: () => Promise<MotionInput> }
export async function show_motion_import (files: File[], motions: MotionLibrary, models: RigLibrary, progress: (text: string) => void): Promise<void> {
  const jobs: Job[] = [], issues: string[] = []
  for (const file of files) {
    progress('Читаю каталог: ' + file.name)
    try {
      if (/\.zip$/i.test(file.name)) {
        const archive = await open_motion_archive(file); issues.push(...archive.issues)
        for (const entry of archive.entries) jobs.push({ name: entry.path, path: entry.path, pack: file.name, size: entry.size, format: entry.format, key: archive.fingerprint + ':' + entry.offset, input: () => archive_input(file, entry) })
        if (!archive.entries.length) issues.push(file.name + ': нет подходящих BVH, FBX или GLB')
      } else {
        const format = input_format(file.name)
        if (!format) { issues.push(file.name + ': нужен BVH, FBX, GLB или ZIP'); continue }
        if (file.size > input_limit(format)) { issues.push(file.name + ': превышен лимит файла'); continue }
        jobs.push({ name: file.name, path: file.name, pack: 'Отдельные файлы', size: file.size, format, input: async () => ({ blob: file, name: file.name, format, size: file.size }) })
      }
      if (jobs.length > 10000) throw new Error('Выберите не больше 10000 файлов за один импорт')
    } catch (error) { issues.push(file.name + ': ' + (error as Error).message) }
  }
  if (jobs.length > 10000) throw new Error('Выберите не больше 10000 файлов за один импорт')
  if (!jobs.length) throw new Error(issues.slice(0, 4).join('\n') || 'Нет подходящих файлов')
  const [old, imported, sources] = await Promise.all([models.list(), motions.list(), motions.sources()]), known = new Set([...old, ...imported].map(e => e.id))
  const dialog = document.createElement('dialog'); dialog.className = 'pack-dialog motion-import-dialog'
  const title = document.createElement('h2'); title.textContent = 'Пополнить библиотеку'
  const description = document.createElement('p'); description.textContent = jobs.length + ' файлов. BVH/FBX сохраняются как скелет и движения. GLB — вместе с моделью. Можно остановить и повторить импорт: готовые записи сохранятся.'
  const limits = document.createElement('p'); limits.className = 'hint'; limits.textContent = 'Обычный ZIP до 4 ГБ · BVH до 32 МБ · FBX до 64 МБ · GLB до 128 МБ на файл. Работает офлайн.'
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Найти файл в наборе'; search.setAttribute('aria-label', 'Поиск в импортируемом наборе')
  const list = document.createElement('div'); list.className = 'pack-list'
  const selected = jobs.map(() => true), all = document.createElement('button'), none = document.createElement('button'), start = document.createElement('button'), close = document.createElement('button'), prev = document.createElement('button'), next = document.createElement('button'), pages = document.createElement('span'), selectedInfo = document.createElement('p')
  all.textContent = 'Все'; none.textContent = 'Снять выбор'; start.textContent = 'Импортировать выбранные'; close.textContent = 'Закрыть'; prev.textContent = '←'; next.textContent = '→'
  prev.setAttribute('aria-label', 'Предыдущие файлы'); next.setAttribute('aria-label', 'Следующие файлы')
  const actions = document.createElement('div'); actions.className = 'pack-actions'; actions.append(all, none, start, close)
  const navigation = document.createElement('div'); navigation.className = 'library-pages'; navigation.append(prev, pages, next)
  const log = document.createElement('p'); log.className = 'pack-log'; log.setAttribute('role', 'status')
  const errors = document.createElement('details'), errorTitle = document.createElement('summary'), errorText = document.createElement('pre'); errorTitle.textContent = 'Пропуски и ошибки'; errorText.textContent = issues.join('\n'); errors.append(errorTitle, errorText); errors.hidden = !issues.length
  let busy = false, stopped = false, page = 0
  const client = new MotionImportClient()
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase(), matches = jobs.map((job, i) => ({ job, i })).filter(({ job }) => job.name.toLocaleLowerCase().includes(query)), count = Math.max(1, Math.ceil(matches.length / 40))
    page = Math.min(page, count - 1); pages.textContent = (page + 1) + ' / ' + count; prev.disabled = page === 0 || busy; next.disabled = page + 1 >= count || busy
    selectedInfo.textContent = 'Выбрано: ' + selected.filter(Boolean).length + ' из ' + jobs.length; list.replaceChildren()
    for (const { job, i } of matches.slice(page * 40, page * 40 + 40)) {
      const label = document.createElement('label'), check = document.createElement('input'), text = document.createElement('span')
      check.type = 'checkbox'; check.checked = selected[i]; check.disabled = busy; check.onchange = () => { selected[i] = check.checked; selectedInfo.textContent = 'Выбрано: ' + selected.filter(Boolean).length + ' из ' + jobs.length }
      text.textContent = job.name + ' · ' + (job.size / 1048576).toFixed(1) + ' МБ'; label.append(check, text); list.append(label)
    }
  }
  all.onclick = () => { selected.fill(true); render() }; none.onclick = () => { selected.fill(false); render() }; search.oninput = () => { page = 0; render() }; prev.onclick = () => { page--; render() }; next.onclick = () => { page++; render() }
  let resolveClosed!: () => void
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  close.onclick = () => { if (busy) { stopped = true; client.close(); close.textContent = 'Останавливаю…' } else { client.close(); dialog.close(); dialog.remove(); resolveClosed() } }
  dialog.oncancel = event => { event.preventDefault(); close.click() }
  start.onclick = async () => {
    if (busy) return
    busy = true; stopped = false; all.disabled = none.disabled = start.disabled = search.disabled = true; close.textContent = 'Остановить'; render()
    let saved = 0, duplicates = 0, failures = 0, processed = 0
    try { await navigator.storage?.persist?.() } catch { /* optional Android quota protection */ }
    for (let i = 0; i < jobs.length && !stopped; i++) {
      if (!selected[i]) continue
      const job = jobs[i]
      log.textContent = 'Обработано ' + processed + ' / ' + selected.filter(Boolean).length + ' · ' + job.name
      try {
        if (job.key && known.has(sources.get(job.key) ?? '')) { duplicates++; processed++; continue }
        const result = await client.read(await job.input(), [...known])
        if (stopped) break
        if (result.kind === 'duplicate') duplicates++
        else if (result.kind === 'glb') {
          await models.save({ id: result.id, title: job.name.replace(/\\/g, '/').split('/').pop()!.replace(/\.glb$/i, ''), created_at: Date.now(), bytes: result.bytes.byteLength, clip_count: result.clips, bone_count: result.bones, skeleton_count: result.skeletons, source_pack: job.pack, source_path: job.path }, result.bytes); saved++
        } else {
          const doc = result.document
          if (await motions.save({ id: result.id, title: doc.name, format: doc.format, created_at: Date.now(), bytes: result.bytes, source_bytes: job.size, clip_count: doc.clips.length, clip_names: doc.clips.map(c => c.name), bone_count: doc.nodes.filter(n => n.joint).length, duration: doc.clips.reduce((sum, c) => sum + c.duration, 0), source_pack: job.pack, source_path: job.path }, doc, job.key)) saved++; else duplicates++
        }
        known.add(result.id)
        if (job.key) { await motions.remember_source(job.key, result.id); sources.set(job.key, result.id) }
      } catch (error) {
        if (stopped) break
        failures++; errors.hidden = false; errorText.textContent += '\n' + job.name + ': ' + (error as Error).message
        if (error instanceof DOMException && error.name === 'QuotaExceededError') { errorText.textContent += '\nНедостаточно места. Готовые записи сохранены.'; break }
      }
      processed++
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    client.close(); busy = false; all.disabled = none.disabled = start.disabled = search.disabled = false; close.textContent = 'Закрыть'; render()
    log.textContent = `Сохранено: ${saved}. Уже было: ${duplicates}. Ошибок: ${failures}.` + (stopped ? ' Импорт остановлен; готовые записи сохранены.' : '')
  }
  dialog.append(title, description, limits, actions, search, selectedInfo, list, navigation, log, errors); document.body.append(dialog); render(); dialog.showModal()
  await closed
}
