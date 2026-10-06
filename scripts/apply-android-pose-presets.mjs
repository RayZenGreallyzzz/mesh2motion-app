import fs from 'node:fs'

const editPath = 'src/lib/processes/edit-skeleton/StepEditSkeleton.ts'
const loadPath = 'src/lib/processes/load-model/StepLoadModel.ts'
const enginePath = 'src/Mesh2MotionEngine.ts'
const domUtilitiesPath = 'src/lib/DOMUtilities.ts'
const htmlPath = 'src/create.html'
const localizationPath = 'src/RigAnimationStudioLocalization.ts'
const tabletCssPath = 'src/rig-animation-studio.css'

function replaceRequired (source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`${label}: marker not found`)
  return source.replace(before, after)
}

function replaceSection (source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`${label}: start marker not found`)
  const end = source.indexOf(endMarker, start)
  if (end < 0) throw new Error(`${label}: end marker not found`)
  return source.slice(0, start) + replacement + source.slice(end)
}

// ---------------------------------------------------------------------------
// Robust GLB loading for Android/WebView: Blob URLs avoid DataURL memory
// amplification, DRACO + Meshopt cover common compressed GLBs, and failures are
// visible instead of silently leaving the user on the load screen.
// ---------------------------------------------------------------------------
let load = fs.readFileSync(loadPath, 'utf8')

if (!load.includes("DRACOLoader")) {
  load = replaceRequired(
    load,
    "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'\n",
    "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'\nimport { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'\nimport { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'\n",
    'StepLoadModel imports'
  )
}

if (!load.includes('private readonly draco_loader')) {
  load = replaceRequired(
    load,
    '  private readonly gltf_loader = new GLTFLoader()\n',
    '  private readonly draco_loader = new DRACOLoader()\n  private readonly gltf_loader = new GLTFLoader()\n  private pending_glb_object_url: string | null = null\n',
    'StepLoadModel loader fields'
  )

  const constructorMarker = '  /**\n   * Skinned mesh data that will be used for retargeting\n'
  const constructor = `  constructor () {\n    super()\n    this.draco_loader.setDecoderPath('/draco/')\n    this.gltf_loader.setDRACOLoader(this.draco_loader)\n    this.gltf_loader.setMeshoptDecoder(MeshoptDecoder)\n  }\n\n`
  if (!load.includes(constructorMarker)) throw new Error('StepLoadModel constructor marker not found')
  load = load.replace(constructorMarker, constructor + constructorMarker)
}

if (!load.includes('this.pending_glb_object_url = object_url')) {
  const uploadStart = '        const file = event.target.files[0]\n'
  const uploadEnd = '      })\n\n      // iOS has a weird issue'
  const start = load.indexOf(uploadStart)
  const end = load.indexOf(uploadEnd, start)
  if (start < 0 || end < 0) throw new Error('StepLoadModel upload block markers not found')

  const uploadBlock = `        const file = (event.target as HTMLInputElement).files?.[0]\n        if (file === undefined) return\n\n        const file_extension: string = Utility.get_file_extension(file.name).toLowerCase()\n        this.source_file_name = file.name\n\n        // GLB is already a binary container. Feeding it to FileReader as a base64\n        // DataURL wastes a large amount of memory in Android WebView and caused\n        // perfectly valid 10-20 MB character files to fail inconsistently.\n        if (file_extension === 'glb') {\n          if (this.pending_glb_object_url !== null) {\n            URL.revokeObjectURL(this.pending_glb_object_url)\n          }\n          const object_url = URL.createObjectURL(file)\n          this.pending_glb_object_url = object_url\n          this.load_model_file(object_url, file_extension)\n          return\n        }\n\n        const reader = new FileReader()\n        reader.readAsDataURL(file)\n        reader.onload = () => {\n          this.load_model_file(reader.result, file_extension)\n        }\n        reader.onerror = () => {\n          new ModalDialog('Ошибка чтения файла', 'Android не смог прочитать выбранный файл. Попробуйте выбрать файл ещё раз.').show()\n        }\n`
  load = load.slice(0, start) + uploadBlock + load.slice(end)
}

const glbStart = "    } else if (file_extension === 'glb') {\n"
const zipStart = "    } else if (file_extension === 'zip') {\n"
const improvedGlbBlock = `    } else if (file_extension === 'glb') {\n      if (typeof model_file_path !== 'string') {\n        this.show_glb_load_error(new Error('GLB source is not a URL'))\n        return\n      }\n\n      const source_url = model_file_path\n      this.gltf_loader.load(\n        source_url,\n        (gltf) => {\n          this.finish_pending_glb_url(source_url)\n          const loaded_scene: Scene = gltf.scene\n          this.process_loaded_scene(loaded_scene)\n        },\n        undefined,\n        (error) => {\n          this.finish_pending_glb_url(source_url)\n          this.show_glb_load_error(error)\n        }\n      )\n`
if (!load.includes('this.show_glb_load_error(error)')) {
  load = replaceSection(load, glbStart, zipStart, improvedGlbBlock, 'StepLoadModel GLB branch')
}

if (!load.includes('private show_glb_load_error')) {
  const helperMarker = '  private load_fbx_file (model_file_path: string | ArrayBuffer | null): void {\n'
  const helpers = `  private finish_pending_glb_url (source_url: string): void {\n    if (this.pending_glb_object_url !== source_url) return\n    URL.revokeObjectURL(source_url)\n    this.pending_glb_object_url = null\n  }\n\n  private show_glb_load_error (error: unknown): void {\n    const raw_message = error instanceof Error ? error.message : String(error)\n    console.error('GLB load failed:', error)\n\n    let hint = 'Файл GLB не удалось открыть.'\n    if (/draco/i.test(raw_message)) {\n      hint += ' Модель использует DRACO-сжатие; встроенный декодер не смог обработать данные.'\n    } else if (/meshopt/i.test(raw_message)) {\n      hint += ' Модель использует Meshopt-сжатие; декодирование завершилось ошибкой.'\n    } else if (/ktx2|basis/i.test(raw_message)) {\n      hint += ' В модели используются KTX2/Basis-текстуры. Для такой модели потребуется KTX2-декодер.'\n    } else {\n      hint += ' Проверьте, что это корректный бинарный glTF 2.0 (.glb).'\n    }\n\n    const details = raw_message.length > 240 ? raw_message.slice(0, 240) + '…' : raw_message\n    new ModalDialog('Ошибка загрузки модели', hint + '<br><br><small>' + details + '</small>').show()\n  }\n\n`
  if (!load.includes(helperMarker)) throw new Error('StepLoadModel helper marker not found')
  load = load.replace(helperMarker, helpers + helperMarker)
}

fs.writeFileSync(loadPath, load)

// ---------------------------------------------------------------------------
// A/T pose v2: use the real shoulder-elbow-wrist chain lengths and flatten the
// chain into the torso plane. This avoids inheriting a backwards Z offset from
// unusual source rigs/rest poses. Joints remain fully editable after preset.
// ---------------------------------------------------------------------------
let edit = fs.readFileSync(editPath, 'utf8')
const poseStart = '  /**\n   * Apply an editable humanoid arm-pose preset.'
const poseEnd = '  /**\n   * Toggle the visibility of the preview plane'
const poseBlock = `  /**\n   * Apply an editable humanoid A/T arm pose without changing bone rotations.\n   * We move joint heads in world space, preserving the measured limb lengths,\n   * and keep each arm in the shoulder plane so it cannot fold behind the body.\n   */\n  public apply_humanoid_arm_pose_preset (pose: 'a' | 't'): void {\n    if (!is_humanoid_skeleton_type(this._current_skeleton_type)) return\n    if (this.threejs_skeleton.bones.length === 0) return\n\n    const downward_angle = pose === 't' ? 0 : 35 * Math.PI / 180\n    const horizontal = Math.cos(downward_angle)\n    const vertical = Math.sin(downward_angle)\n\n    this.store_bone_state_for_undo()\n    let applied = false\n\n    for (const side of ['l', 'r'] as const) {\n      const upperarm = this.find_arm_bone('upper', side)\n      const lowerarm = this.find_arm_bone('lower', side)\n      const hand = this.find_arm_bone('hand', side)\n      if (upperarm === undefined || lowerarm === undefined || hand === undefined) continue\n\n      this.threejs_skeleton.bones[0]?.updateWorldMatrix(true, true)\n      const shoulder = upperarm.getWorldPosition(new Vector3())\n      const elbow = lowerarm.getWorldPosition(new Vector3())\n      const wrist = hand.getWorldPosition(new Vector3())\n\n      const upper_length = shoulder.distanceTo(elbow)\n      const lower_length = elbow.distanceTo(wrist)\n      if (upper_length <= 0.0001 || lower_length <= 0.0001) continue\n\n      // Preserve the model's actual left/right orientation instead of assuming\n      // that a particular bone suffix always maps to +X or -X.\n      const x_delta = Math.abs(elbow.x - shoulder.x) > 0.0001\n        ? elbow.x - shoulder.x\n        : wrist.x - shoulder.x\n      const side_sign = Math.sign(x_delta) || (side === 'l' ? 1 : -1)\n\n      const arm_direction = new Vector3(\n        side_sign * horizontal,\n        -vertical,\n        0\n      ).normalize()\n\n      const elbow_target = shoulder.clone().addScaledVector(arm_direction, upper_length)\n      this.set_bone_world_position(lowerarm, elbow_target)\n\n      const updated_elbow = lowerarm.getWorldPosition(new Vector3())\n      const wrist_target = updated_elbow.clone().addScaledVector(arm_direction, lower_length)\n      this.set_bone_world_position(hand, wrist_target)\n      applied = true\n    }\n\n    if (applied) {\n      this.threejs_skeleton.bones[0]?.updateWorldMatrix(true, true)\n      this.refresh_arm_plane_position()\n      this.dispatchEvent(new CustomEvent('skeletonTransformed'))\n    }\n  }\n\n  private find_arm_bone (role: 'upper' | 'lower' | 'hand', side: 'l' | 'r'): Bone | undefined {\n    const aliases: Record<'upper' | 'lower' | 'hand', Record<'l' | 'r', string[]>> = {\n      upper: {\n        l: ['upperarm_l', 'leftarm', 'upperarml', 'leftupperarm'],\n        r: ['upperarm_r', 'rightarm', 'upperarmr', 'rightupperarm']\n      },\n      lower: {\n        l: ['lowerarm_l', 'leftforearm', 'forearml', 'leftlowerarm'],\n        r: ['lowerarm_r', 'rightforearm', 'forearmr', 'rightlowerarm']\n      },\n      hand: {\n        l: ['hand_l', 'lefthand', 'handl'],\n        r: ['hand_r', 'righthand', 'handr']\n      }\n    }\n\n    const wanted = new Set(aliases[role][side].map(name => name.replace(/[^a-z0-9]/g, '')))\n    return this.threejs_skeleton.bones.find((bone) => {\n      const normalized = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '')\n      return wanted.has(normalized)\n    })\n  }\n\n  private set_bone_world_position (bone: Bone, world_position: Vector3): void {\n    if (bone.parent === null) return\n    bone.parent.updateWorldMatrix(true, false)\n    bone.position.copy(bone.parent.worldToLocal(world_position.clone()))\n    bone.updateWorldMatrix(true, true)\n  }\n\n`
edit = replaceSection(edit, poseStart, poseEnd, poseBlock, 'StepEditSkeleton A/T v2')
fs.writeFileSync(editPath, edit)

// ---------------------------------------------------------------------------
// Tablet touch: keep desktop precision but make joint picking forgiving on a
// coarse pointer (finger/stylus). Existing PointerEvent + pointer capture logic
// remains unchanged.
// ---------------------------------------------------------------------------
let engine = fs.readFileSync(enginePath, 'utf8')
engine = replaceRequired(
  engine,
  '  public readonly transform_controls_hover_distance: number = 0.02 // distance to hover over bones to select them\n',
  "  public readonly transform_controls_hover_distance: number = window.matchMedia?.('(pointer: coarse)').matches ? 0.055 : 0.02 // larger finger hit radius on tablets\n",
  'Mesh2MotionEngine tablet hit radius'
)
fs.writeFileSync(enginePath, engine)

// ---------------------------------------------------------------------------
// Branding + settings: APK gets its own identity, no GitHub/support links, and
// an explicit Russian/English language selector in Settings.
// ---------------------------------------------------------------------------
let dom = fs.readFileSync(domUtilitiesPath, 'utf8')
const topNavStart = '  static populate_top_nav_links (mount: HTMLElement): void {\n'
const topNavEnd = '  /**\n   * Render shared viewport mouse control hints'
const topNavReplacement = `  static populate_top_nav_links (mount: HTMLElement): void {\n    mount.style.display = 'inline-flex'\n    mount.style.alignItems = 'center'\n    mount.innerHTML = '<span id="settings-dropdown-mount"></span>'\n  }\n\n`
dom = replaceSection(dom, topNavStart, topNavEnd, topNavReplacement, 'DOMUtilities APK navigation')

if (!dom.includes('id="app-language-select"')) {
  const settingsMarker = `        <div id="settings-dropdown-content" class="nav-dropdown-content" hidden>\n`
  const languageMarkup = `        <div id="settings-dropdown-content" class="nav-dropdown-content" hidden>\n          <div class="settings-dropdown-row">\n            <label for="app-language-select">Language</label>\n            <select id="app-language-select" aria-label="Language">\n              <option value="ru">Русский</option>\n              <option value="en">English</option>\n            </select>\n          </div>\n\n`
  dom = replaceRequired(dom, settingsMarker, languageMarkup, 'DOMUtilities language setting')
}
fs.writeFileSync(domUtilitiesPath, dom)

let html = fs.readFileSync(htmlPath, 'utf8')
html = html.replace('<html lang="en">', '<html lang="ru">')
html = html.replace('<title style="display: none">Create - Mesh2Motion</title>', '<title>Rig Animation Studio</title>')

const navStart = '    <nav>\n'
const navEnd = '    </nav>\n'
const navMarkup = `    <nav class="ras-nav">\n      <div id="ras-branding" aria-label="Rig Animation Studio">\n        <span class="ras-brand-mark">RA</span>\n        <span class="ras-brand-copy">\n          <strong>Rig Animation Studio</strong>\n          <small>Mobile Rig &amp; Animation</small>\n        </span>\n      </div>\n      <div style="display: inline-flex; align-items: center;">\n        <div id="top-nav-links-mount"></div>\n      </div>\n    </nav>\n`
html = replaceSection(html, navStart, navEnd, navMarkup, 'create.html branding nav')

if (!html.includes('rig-animation-studio.css')) {
  html = html.replace(
    '    <link rel="stylesheet" href="./offline.css" crossorigin="anonymous" />\n',
    '    <link rel="stylesheet" href="./offline.css" crossorigin="anonymous" />\n    <link rel="stylesheet" href="./rig-animation-studio.css" crossorigin="anonymous" />\n'
  )
}
if (!html.includes('RigAnimationStudioLocalization.ts')) {
  html = html.replace(
    '    <!-- build version information-->\n',
    '    <script type="module" src="./RigAnimationStudioLocalization.ts"></script>\n\n    <!-- build version information-->\n'
  )
}
fs.writeFileSync(htmlPath, html)

// ---------------------------------------------------------------------------
// Lightweight runtime localization. It also observes dynamic step labels and
// controls created after startup, while preserving the original English text so
// switching back to English works without reloading the app.
// ---------------------------------------------------------------------------
const localization = `type AppLanguage = 'ru' | 'en'\n\ninterface TextState {\n  source: string\n  last: string\n}\n\nconst translations: Record<string, string> = {\n  'Language': 'Язык',\n  'Settings': 'Настройки',\n  'Light intensity': 'Яркость света',\n  'Turntable': 'Вращение модели',\n  'Show floor grid': 'Показывать сетку пола',\n  'Solid background': 'Сплошной фон',\n  'Upload': 'Загрузить',\n  'or': 'или',\n  'Reference model': 'Эталонная модель',\n  'Load': 'Загрузить',\n  'Debug': 'Отладка',\n  'Load Model': 'Загрузка модели',\n  'Rotate Model to face front (blue origin line)': 'Поверните модель лицом вперёд (синяя линия начала координат)',\n  'Position model': 'Положение модели',\n  'Analyze Import': 'Проверить импорт',\n  'Reset position': 'Сбросить положение',\n  'Auto-align to floor': 'Выровнять по полу',\n  'Skeleton template': 'Шаблон скелета',\n  'Hand Options': 'Настройки кистей',\n  'All Fingers': 'Все пальцы',\n  'Thumb + Main Finger': 'Большой + указательный',\n  'All Fingers - Simplified': 'Все пальцы — упрощённо',\n  'Single Hand Bone': 'Одна кость кисти',\n  'Scale skeleton': 'Масштаб скелета',\n  'Back': 'Назад',\n  'Edit Skeleton ›': 'Править скелет ›',\n  'Position Joints': 'Расстановка суставов',\n  'Arm Pose': 'Поза рук',\n  'Choose a starting pose, then drag joints directly on the model.': 'Выберите стартовую позу, затем двигайте суставы прямо на модели.',\n  'Positioning': 'Расстановка',\n  'Mesh volume': 'По объёму модели',\n  'Transform Widget': 'Манипулятор',\n  'Transform': 'Трансформация',\n  'Space': 'Координаты',\n  'Move Bone Children': 'Двигать дочерние кости',\n  'Yes': 'Да',\n  'No': 'Нет',\n  'Preview Display': 'Предпросмотр',\n  'Weights': 'Веса',\n  'Textured': 'Текстура',\n  'Mirror Left/Right Joints': 'Зеркалить левую/правую сторону',\n  'Use Head Weight Correction': 'Коррекция весов головы',\n  'Height:': 'Высота:',\n  'Use Arm Plane Correction': 'Коррекция плоскости рук',\n  'Distance:': 'Расстояние:',\n  'Bind pose': 'Привязать скелет',\n  'Finish ›': 'Готово ›',\n  'Library': 'Библиотека',\n  'Selected': 'Выбранные',\n  'Filter': 'Фильтр',\n  'Select All': 'Выбрать всё',\n  'Deselect All': 'Снять выбор',\n  'Loading animation data': 'Загрузка анимаций',\n  'Props': 'Оружие / предметы',\n  'Selected Bone': 'Выбранная кость',\n  'No animation selected': 'Анимация не выбрана',\n  'Download': 'Экспорт',\n  'Download Options': 'Настройки экспорта',\n  'Bone Naming Pattern': 'Имена костей',\n  'File Format': 'Формат файла',\n  'FBX Preset': 'Профиль FBX',\n  'Contents': 'Содержимое',\n  'Expand / Contract Arms': 'Расширить / сузить руки',\n  'Rotate': 'Вращение',\n  'Pan': 'Перемещение',\n  'Zoom': 'Масштаб',\n  'Rig Template': 'Шаблон рига',\n  'Play': 'Воспроизвести'\n}\n\nconst textStates = new WeakMap<Text, TextState>()\nlet currentLanguage: AppLanguage = 'ru'\nlet translating = false\nlet observer: MutationObserver | null = null\n\nfunction normalize (value: string): string {\n  return value.replace(/\\s+/g, ' ').trim()\n}\n\nfunction translateTextNode (node: Text): void {\n  const raw = node.textContent ?? ''\n  const current = normalize(raw)\n  if (current.length === 0) return\n\n  let state = textStates.get(node)\n  if (state === undefined || (current !== normalize(state.last) && current !== normalize(state.source))) {\n    state = { source: current, last: current }\n    textStates.set(node, state)\n  }\n\n  const source = state.source\n  let target = source\n  if (currentLanguage === 'ru') {\n    target = translations[source] ?? source\n    const countMatch = source.match(/^(\\d+) animations$/)\n    if (countMatch !== null) target = countMatch[1] + ' анимаций'\n  }\n\n  const leading = raw.match(/^\\s*/)?.[0] ?? ''\n  const trailing = raw.match(/\\s*$/)?.[0] ?? ''\n  const next = leading + target + trailing\n  if (raw !== next) node.textContent = next\n  state.last = target\n}\n\nfunction translateAttributes (): void {\n  document.querySelectorAll<HTMLElement>('[placeholder]').forEach((element) => {\n    const original = element.dataset.rasOriginalPlaceholder ?? element.getAttribute('placeholder') ?? ''\n    element.dataset.rasOriginalPlaceholder = original\n    element.setAttribute('placeholder', currentLanguage === 'ru' ? (translations[original] ?? original) : original)\n  })\n}\n\nfunction applyLanguage (): void {\n  if (translating) return\n  translating = true\n  observer?.disconnect()\n\n  document.documentElement.lang = currentLanguage\n  document.title = currentLanguage === 'ru' ? 'Rig Animation Studio — Риг и анимация' : 'Rig Animation Studio'\n\n  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)\n  let node = walker.nextNode()\n  while (node !== null) {\n    translateTextNode(node as Text)\n    node = walker.nextNode()\n  }\n  translateAttributes()\n\n  observer?.observe(document.body, { childList: true, subtree: true, characterData: true })\n  translating = false\n}\n\nfunction initializeLocalization (): void {\n  const languageSelect = document.querySelector<HTMLSelectElement>('#app-language-select')\n  if (languageSelect === null) {\n    window.setTimeout(initializeLocalization, 50)\n    return\n  }\n\n  const stored = localStorage.getItem('ras-language')\n  currentLanguage = stored === 'en' ? 'en' : 'ru'\n  languageSelect.value = currentLanguage\n\n  languageSelect.addEventListener('change', () => {\n    currentLanguage = languageSelect.value === 'en' ? 'en' : 'ru'\n    localStorage.setItem('ras-language', currentLanguage)\n    applyLanguage()\n  })\n\n  observer = new MutationObserver(() => applyLanguage())\n  applyLanguage()\n}\n\nif (document.readyState === 'loading') {\n  window.addEventListener('DOMContentLoaded', initializeLocalization, { once: true })\n} else {\n  initializeLocalization()\n}\n\nexport {}\n`
fs.writeFileSync(localizationPath, localization)

// ---------------------------------------------------------------------------
// Tablet-first polish. Keep desktop behavior intact; only coarse pointers and
// tablet-sized viewports receive larger hit targets and a roomier tool panel.
// ---------------------------------------------------------------------------
const tabletCss = `:root {\n  --ras-fire: #ff7a1a;\n  --ras-fire-soft: #ffad5a;\n  --ras-panel: rgba(17, 18, 22, 0.96);\n}\n\n.ras-nav {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  min-height: 54px;\n  padding: 0 18px;\n  background: linear-gradient(90deg, rgba(17,18,22,.98), rgba(38,22,14,.96));\n  border-bottom: 1px solid rgba(255,122,26,.35);\n}\n\n#ras-branding {\n  display: inline-flex;\n  align-items: center;\n  gap: 10px;\n  user-select: none;\n}\n\n.ras-brand-mark {\n  display: grid;\n  place-items: center;\n  width: 38px;\n  height: 38px;\n  border-radius: 11px;\n  font-weight: 900;\n  letter-spacing: -1px;\n  color: #160b04;\n  background: radial-gradient(circle at 35% 30%, #ffd08a 0, #ff8a24 42%, #d63a10 72%, #411006 100%);\n  box-shadow: 0 0 18px rgba(255,100,25,.28), inset 0 0 0 1px rgba(255,255,255,.18);\n}\n\n.ras-brand-copy {\n  display: flex;\n  flex-direction: column;\n  line-height: 1.05;\n}\n\n.ras-brand-copy strong {\n  font-size: 15px;\n  letter-spacing: .02em;\n}\n\n.ras-brand-copy small {\n  margin-top: 4px;\n  opacity: .62;\n  font-size: 10px;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n}\n\n#build-version { display: none !important; }\n\n#humanoid-pose-presets {\n  padding: 10px;\n  border-radius: 10px;\n  background: linear-gradient(135deg, rgba(255,122,26,.10), rgba(255,122,26,.025));\n  border: 1px solid rgba(255,122,26,.22);\n}\n\n#humanoid-pose-presets .secondary-button {\n  flex: 1;\n}\n\n@media (pointer: coarse), (max-width: 1366px) {\n  html, body {\n    overscroll-behavior: none;\n    -webkit-tap-highlight-color: transparent;\n  }\n\n  .ras-nav { min-height: 62px; padding: 0 14px; }\n  .ras-brand-mark { width: 44px; height: 44px; border-radius: 13px; }\n  .ras-brand-copy strong { font-size: 17px; }\n\n  #header-ui-mount { display: none; }\n\n  #tool-panel {\n    width: min(360px, 38vw) !important;\n    max-height: calc(100dvh - 70px);\n    overflow-y: auto;\n    overscroll-behavior: contain;\n    scrollbar-width: thin;\n    background: var(--ras-panel);\n  }\n\n  button, .button, select, input[type='number'], input[type='text'] {\n    min-height: 44px;\n    font-size: 15px;\n  }\n\n  .secondary-button, .no-style-button {\n    min-height: 44px;\n    padding-top: 9px;\n    padding-bottom: 9px;\n  }\n\n  #humanoid-pose-presets .secondary-button {\n    min-height: 52px;\n    min-width: 96px;\n    font-size: 18px;\n    font-weight: 750;\n  }\n\n  #settings-toggle {\n    min-width: 48px;\n    min-height: 48px;\n  }\n\n  #settings-dropdown-content {\n    min-width: 270px;\n    font-size: 15px;\n  }\n\n  #selected-bone-overlay { pointer-events: none; }\n}\n\n@media (orientation: landscape) and (pointer: coarse) {\n  #tool-panel {\n    width: min(370px, 34vw) !important;\n  }\n}\n`
fs.writeFileSync(tabletCssPath, tabletCss)

console.log('Rig Animation Studio Android v2 patches applied')
