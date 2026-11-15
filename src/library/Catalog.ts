import { builtin_models } from './BuiltinModels.ts'
import packs from './phoenix-packs.json'
import { RigConfig } from '../lib/RigConfig.ts'

const standard_titles: Record<string, string> = {
  'human-base': 'Человек — основные движения',
  'human-addon': 'Человек — дополнительные движения',
  'human-mocap': 'Человек — захват движений',
  fox: 'Лиса — штатные движения',
  bird: 'Птица — штатные движения',
  dragon: 'Дракон — штатные движения',
  kaiju: 'Кайдзю — штатные движения',
  spider: 'Паук — штатные движения',
  snake: 'Змея — штатные движения',
  shark: 'Акула — штатные движения',
  horse: 'Лошадь — штатные движения'
}

const standard_packs = new Map<string, { path: string, title: string, rig: string }>()
for (const rig of RigConfig.all) {
  if (rig.pack_source) continue
  for (const file of rig.animation_files) {
    const path = file.replace(/^\.\.\//, '')
    if (standard_packs.has(path)) continue
    const key = path.split('/').at(-1)!.replace(/-animations\.glb$/, '')
    standard_packs.set(path, { path, title: standard_titles[key] ?? rig.rig_display_name, rig: rig.skeleton_type })
  }
}

export function mount_catalog (host: HTMLElement, open: (path: string, title: string) => void, take?: (path: string, title: string) => void, canTake: () => boolean = () => true): void {
  const heading = document.createElement('h2'); heading.textContent = 'Встроенные персонажи и движения'
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Человек, волк, дракон…'; search.setAttribute('aria-label', 'Поиск встроенных наборов')
  const list = document.createElement('div'); list.className = 'builtin-catalog'
  const render = (): void => {
    list.replaceChildren()
    const items = [
      ...[...standard_packs.values()].map(pack => ({ ...pack, hasMotions: true, subtitle: 'Mesh2Motion', link: '../create.html?rig=' + encodeURIComponent(pack.rig), action: 'Выбрать скелет' })),
      ...packs.map(pack => ({ ...pack, hasMotions: pack.clips > 0, subtitle: pack.category + ' · ' + pack.bones + ' костей · ' + pack.clips + ' движений', link: '../create.html?rig=' + encodeURIComponent('pack:' + pack.id), action: 'Выбрать скелет' })),
      ...builtin_models.map(model => ({ ...model, hasMotions: false, subtitle: 'Манекен · внешний вид', link: '../create.html?builtin=' + model.id, action: 'Создать риг' }))
    ]
    for (const item of items) {
      if (!(item.title + ' ' + item.subtitle).toLowerCase().includes(search.value.trim().toLowerCase())) continue
      const card = document.createElement('article'); card.className = 'library-card'
      const title = document.createElement('h3'); title.textContent = item.title
      const info = document.createElement('p'); info.textContent = item.subtitle
      const actions = document.createElement('div'), preview = document.createElement('button'), use = document.createElement('a')
      preview.textContent = 'Просмотреть'; preview.onclick = () => open(item.path, item.title)
      use.textContent = item.action; use.href = item.link; use.className = 'catalog-link'
      actions.append(preview, use);
      if (take && item.hasMotions) { const motion = document.createElement('button'); motion.textContent = 'Взять движения'; motion.dataset.motion = 'true'; motion.disabled = !canTake(); motion.onclick = () => take(item.path, item.title); actions.append(motion) }
      card.append(title, info, actions); list.append(card)
    }
  }
  search.oninput = render; host.append(heading, search, list); render()
}
