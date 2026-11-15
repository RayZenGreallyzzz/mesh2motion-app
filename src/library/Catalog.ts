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

const standard_packs = new Map<string, { path: string, title: string }>()
for (const rig of RigConfig.all) {
  if (rig.pack_source) continue
  for (const file of rig.animation_files) {
    const path = file.replace(/^\.\.\//, '')
    if (standard_packs.has(path)) continue
    const key = path.split('/').at(-1)!.replace(/-animations\.glb$/, '')
    standard_packs.set(path, { path, title: standard_titles[key] ?? rig.rig_display_name })
  }
}

export function mount_catalog (host: HTMLElement, take: (path: string, title: string) => void, canTake: () => boolean = () => true): void {
  const heading = document.createElement('h2'); heading.textContent = 'Встроенные движения'
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Человек, волк, дракон…'; search.setAttribute('aria-label', 'Поиск встроенных наборов')
  const list = document.createElement('div'); list.className = 'builtin-catalog'
  const render = (): void => {
    list.replaceChildren()
    const items = [
      ...[...standard_packs.values()].map(pack => ({ ...pack, subtitle: 'Mesh2Motion' })),
      ...packs.filter(pack => pack.clips > 0).map(pack => ({ ...pack, subtitle: pack.category + ' · ' + pack.bones + ' костей · ' + pack.clips + ' движений' }))
    ]
    for (const item of items) {
      if (!(item.title + ' ' + item.subtitle).toLowerCase().includes(search.value.trim().toLowerCase())) continue
      const card = document.createElement('article'); card.className = 'library-card'
      const title = document.createElement('h3'); title.textContent = item.title
      const info = document.createElement('p'); info.textContent = item.subtitle
      const actions = document.createElement('div'), motion = document.createElement('button')
      motion.textContent = 'Взять движения'; motion.dataset.motion = 'true'; motion.disabled = !canTake()
      motion.onclick = () => take(item.path, item.title); actions.append(motion)
      card.append(title, info, actions); list.append(card)
    }
  }
  search.oninput = render; host.append(heading, search, list); render()
}
