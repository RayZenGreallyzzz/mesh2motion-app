type AppLanguage = 'ru' | 'en'

interface TextState {
  source: string
  last: string
}

const translations: Record<string, string> = {
  'Language': 'Язык',
  'Settings': 'Настройки',
  'Light intensity': 'Яркость света',
  'Turntable': 'Вращение модели',
  'Show floor grid': 'Показывать сетку пола',
  'Solid background': 'Сплошной фон',
  'Upload': 'Загрузить',
  'or': 'или',
  'Reference model': 'Эталонная модель',
  'Load': 'Загрузить',
  'Debug': 'Отладка',
  'Load Model': 'Загрузка модели',
  'Rotate Model to face front (blue origin line)': 'Поверните модель лицом вперёд (синяя линия начала координат)',
  'Position model': 'Положение модели',
  'Analyze Import': 'Проверить импорт',
  'Reset position': 'Сбросить положение',
  'Auto-align to floor': 'Выровнять по полу',
  'Skeleton template': 'Шаблон скелета',
  'Hand Options': 'Настройки кистей',
  'All Fingers': 'Все пальцы',
  'Thumb + Main Finger': 'Большой + указательный',
  'All Fingers - Simplified': 'Все пальцы — упрощённо',
  'Single Hand Bone': 'Одна кость кисти',
  'Scale skeleton': 'Масштаб скелета',
  'Back': 'Назад',
  'Edit Skeleton ›': 'Править скелет ›',
  'Position Joints': 'Расстановка суставов',
  'Arm Pose': 'Поза рук',
  'Choose a starting pose, then drag joints directly on the model.': 'Выберите стартовую позу, затем двигайте суставы прямо на модели.',
  'Positioning': 'Расстановка',
  'Mesh volume': 'По объёму модели',
  'Transform Widget': 'Манипулятор',
  'Transform': 'Трансформация',
  'Space': 'Координаты',
  'Move Bone Children': 'Двигать дочерние кости',
  'Yes': 'Да',
  'No': 'Нет',
  'Preview Display': 'Предпросмотр',
  'Weights': 'Веса',
  'Textured': 'Текстура',
  'Mirror Left/Right Joints': 'Зеркалить левую/правую сторону',
  'Use Head Weight Correction': 'Коррекция весов головы',
  'Height:': 'Высота:',
  'Use Arm Plane Correction': 'Коррекция плоскости рук',
  'Distance:': 'Расстояние:',
  'Bind pose': 'Привязать скелет',
  'Finish ›': 'Готово ›',
  'Library': 'Библиотека',
  'Selected': 'Выбранные',
  'Filter': 'Фильтр',
  'Select All': 'Выбрать всё',
  'Deselect All': 'Снять выбор',
  'Loading animation data': 'Загрузка анимаций',
  'Props': 'Оружие / предметы',
  'Selected Bone': 'Выбранная кость',
  'No animation selected': 'Анимация не выбрана',
  'Download': 'Экспорт',
  'Download Options': 'Настройки экспорта',
  'Bone Naming Pattern': 'Имена костей',
  'File Format': 'Формат файла',
  'FBX Preset': 'Профиль FBX',
  'Contents': 'Содержимое',
  'Expand / Contract Arms': 'Расширить / сузить руки',
  'Rotate': 'Вращение',
  'Pan': 'Перемещение',
  'Zoom': 'Масштаб',
  'Rig Template': 'Шаблон рига',
  'Play': 'Воспроизвести'
}

const textStates = new WeakMap<Text, TextState>()
let currentLanguage: AppLanguage = 'ru'
let translating = false
let observer: MutationObserver | null = null

function normalize (value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function translateTextNode (node: Text): void {
  const raw = node.textContent ?? ''
  const current = normalize(raw)
  if (current.length === 0) return

  let state = textStates.get(node)
  if (state === undefined || (current !== normalize(state.last) && current !== normalize(state.source))) {
    state = { source: current, last: current }
    textStates.set(node, state)
  }

  const source = state.source
  let target = source
  if (currentLanguage === 'ru') {
    target = translations[source] ?? source
    const countMatch = source.match(/^(\d+) animations$/)
    if (countMatch !== null) target = countMatch[1] + ' анимаций'
  }

  const leading = raw.match(/^\s*/)?.[0] ?? ''
  const trailing = raw.match(/\s*$/)?.[0] ?? ''
  const next = leading + target + trailing
  if (raw !== next) node.textContent = next
  state.last = target
}

function translateAttributes (): void {
  document.querySelectorAll<HTMLElement>('[placeholder]').forEach((element) => {
    const original = element.dataset.rasOriginalPlaceholder ?? element.getAttribute('placeholder') ?? ''
    element.dataset.rasOriginalPlaceholder = original
    element.setAttribute('placeholder', currentLanguage === 'ru' ? (translations[original] ?? original) : original)
  })
}

function applyLanguage (): void {
  if (translating) return
  translating = true
  observer?.disconnect()

  document.documentElement.lang = currentLanguage
  document.title = currentLanguage === 'ru' ? 'Rig Animation Studio — Риг и анимация' : 'Rig Animation Studio'

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    translateTextNode(node as Text)
    node = walker.nextNode()
  }
  translateAttributes()

  observer?.observe(document.body, { childList: true, subtree: true, characterData: true })
  translating = false
}

function initializeLocalization (): void {
  const languageSelect = document.querySelector<HTMLSelectElement>('#app-language-select')
  if (languageSelect === null) {
    window.setTimeout(initializeLocalization, 50)
    return
  }

  const stored = localStorage.getItem('ras-language')
  currentLanguage = stored === 'en' ? 'en' : 'ru'
  languageSelect.value = currentLanguage

  languageSelect.addEventListener('change', () => {
    currentLanguage = languageSelect.value === 'en' ? 'en' : 'ru'
    localStorage.setItem('ras-language', currentLanguage)
    applyLanguage()
  })

  observer = new MutationObserver(() => applyLanguage())
  applyLanguage()
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initializeLocalization, { once: true })
} else {
  initializeLocalization()
}

export {}
