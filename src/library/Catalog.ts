import { builtin_models } from './BuiltinModels.ts'
import packs from './phoenix-packs.json'

export function mount_catalog (host: HTMLElement, open: (path: string, title: string) => void, take?: (path: string, title: string) => void, canTake: () => boolean = () => true): void {
  const heading = document.createElement('h2'); heading.textContent = 'Встроенные персонажи и движения'
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Человек, волк, дракон…'; search.setAttribute('aria-label', 'Поиск встроенных наборов')
  const list = document.createElement('div'); list.className = 'builtin-catalog'
  const render = (): void => {
    list.replaceChildren()
    const items = [
      ...builtin_models.map(model => ({ ...model, subtitle: 'Манекен · внешний вид', link: '../create.html?builtin=' + model.id, action: 'Создать риг' })),
      ...packs.map(pack => ({ ...pack, subtitle: pack.category + ' · ' + pack.bones + ' костей · ' + pack.clips + ' движений', link: '../create.html?rig=' + encodeURIComponent('pack:' + pack.id), action: 'Выбрать скелет' }))
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
      if (take && 'clips' in item && typeof item.clips === 'number' && item.clips > 0) { const motion = document.createElement('button'); motion.textContent = 'Взять движения'; motion.dataset.motion = 'true'; motion.disabled = !canTake(); motion.onclick = () => take(item.path, item.title); actions.append(motion) }
      card.append(title, info, actions); list.append(card)
    }
  }
  search.oninput = render; host.append(heading, search, list); render()
}
