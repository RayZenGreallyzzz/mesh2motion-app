import '../mobile.css'

// The renderer and pointer coordinates keep using the full viewport. The panel
// can be hidden while placing joints, so touch input stays aligned with the model.
const panel = document.querySelector<HTMLElement>('#tool-panel')
if (panel) {
  const toggle = document.createElement('button')
  toggle.id = 'mobile-panel-toggle'
  toggle.className = 'secondary-button'
  toggle.setAttribute('aria-controls', 'tool-panel')
  toggle.setAttribute('aria-expanded', 'true')
  toggle.textContent = 'Скрыть панель'
  toggle.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('mobile-panel-hidden')
    toggle.textContent = hidden ? 'Показать панель' : 'Скрыть панель'
    toggle.setAttribute('aria-expanded', String(!hidden))
  })
  document.body.appendChild(toggle)
}

if (window.Mesh2MotionNative) {
  document.documentElement.dataset.android = 'true'
  const model_tools = document.querySelector('#load-model-tools')
  if (model_tools) {
    const help = document.createElement('details')
    help.className = 'android-help'
    help.innerHTML = `<summary>Как подготовить персонажа</summary>
      <p>Загрузи GLB или FBX. Для GLTF с текстурами используй ZIP.</p>
      <p>Персонаж должен стоять прямо в T- или A-позе, руки отдельно от туловища.
      Совмести суставы с плечами, локтями, тазом и коленями; проверь вид спереди и сбоку.</p>
      <p>Перед экспортом проверь ходьбу и движение рук. Автопривязка не исправляет любую модель без настройки.</p>
      <p>Если скелет уже хороший, открой «Use Your Rigged Model», чтобы сохранить его.</p>`
    model_tools.prepend(help)
  }
}
