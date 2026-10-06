import { UI } from '../../../UI.ts'
import { ModalDialog } from '../../../ModalDialog.ts'
import { PropCatalog } from './PropCatalog.ts'
import { PropPicker } from './PropPicker.ts'
import { PropSide } from './PropSide.ts'
import { PropType } from './PropType.ts'
import { type PropSelection } from './PropSelection.ts'

export class PropsPanel extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private left_picker: PropPicker | null = null
  private right_picker: PropPicker | null = null
  private added_event_listeners: boolean = false

  public initialize (): void {
    if (this.added_event_listeners) {
      return
    }

    const dom_left_hand = document.querySelector<HTMLElement>('#props-left-hand')
    const dom_right_hand = document.querySelector<HTMLElement>('#props-right-hand')
    if (dom_left_hand === null || dom_right_hand === null) {
      return
    }

    this.left_picker = new PropPicker(dom_left_hand, 'Left')
    this.right_picker = new PropPicker(dom_right_hand, 'Right')
    this.left_picker.addEventListener('change', () => { this.dispatch_selection_changed() })
    this.right_picker.addEventListener('change', () => { this.dispatch_selection_changed() })

    this.install_custom_weapon_import()

    // the toggle only shows while collapsed; the close button inside the panel collapses it
    this.ui.dom_props_toggle_button?.addEventListener('click', () => {
      this.set_expanded(true)
      this.ui.dom_props_close_button?.focus()
    })
    this.ui.dom_props_close_button?.addEventListener('click', () => {
      this.set_expanded(false)
      this.ui.dom_props_toggle_button?.focus()
    })

    // keep the floating panel docked beside the tool panel as its width changes
    const tool_panel = document.querySelector<HTMLElement>('#tool-panel')
    const dock = this.ui.dom_props_dock
    if (tool_panel !== null && dock !== null) {
      new ResizeObserver(() => {
        dock.style.right = `calc(${tool_panel.offsetWidth}px + 0.5rem)`
      }).observe(tool_panel)
    }

    this.added_event_listeners = true
  }

  public set_visible (is_visible: boolean): void {
    if (this.ui.dom_props_dock !== null) {
      this.ui.dom_props_dock.style.display = is_visible ? '' : 'none'
    }

    if (!is_visible) {
      this.set_expanded(false)
    }
  }

  public set_side_enabled (side: PropSide, is_enabled: boolean): void {
    const picker = side === PropSide.Left ? this.left_picker : this.right_picker
    picker?.set_enabled(is_enabled, 'No hand bone was found for this side')
  }

  public set_selection (selection: PropSelection): void {
    if (this.left_picker !== null) { this.left_picker.value = selection.left }
    if (this.right_picker !== null) { this.right_picker.value = selection.right }
  }

  private install_custom_weapon_import (): void {
    const panel = this.ui.dom_props_panel
    if (panel === null || panel.querySelector('#custom-prop-import-button') !== null) return

    const controls = document.createElement('div')
    controls.className = 'custom-prop-import-controls'
    controls.innerHTML = `
      <button type="button" class="secondary-button" id="custom-prop-import-button" title="Загрузить своё оружие GLB">
        <span aria-hidden="true">＋</span>
        <span>Своё GLB</span>
      </button>
      <input id="custom-prop-import-input" type="file" accept="*/*" hidden />
    `

    const close_button = this.ui.dom_props_close_button
    if (close_button !== null) {
      panel.insertBefore(controls, close_button)
    } else {
      panel.appendChild(controls)
    }

    const import_button = controls.querySelector<HTMLButtonElement>('#custom-prop-import-button')
    const import_input = controls.querySelector<HTMLInputElement>('#custom-prop-import-input')

    import_button?.addEventListener('click', () => {
      import_input?.click()
    })

    import_input?.addEventListener('change', () => {
      const file = import_input.files?.[0]
      import_input.value = ''
      if (file === undefined) return

      if (!file.name.toLowerCase().endsWith('.glb')) {
        new ModalDialog('Оружие', 'Сейчас для своего оружия поддерживается формат GLB.').show()
        return
      }

      PropCatalog.register_custom_glb(file)
      this.left_picker?.refresh_options()
      this.right_picker?.refresh_options()

      // Put a newly imported weapon in the right hand by default. The new
      // "Custom" item remains available in both pickers, so the user can move
      // it to the left hand or use it in both hands afterwards.
      if (this.right_picker !== null) {
        this.right_picker.value = PropType.Custom
      }
      this.dispatch_selection_changed()
    })
  }

  private set_expanded (is_expanded: boolean): void {
    if (this.ui.dom_props_panel !== null) {
      this.ui.dom_props_panel.hidden = !is_expanded
    }

    const toggle_button = this.ui.dom_props_toggle_button
    if (toggle_button !== null) {
      toggle_button.setAttribute('aria-expanded', String(is_expanded))
      toggle_button.hidden = is_expanded
    }

    if (!is_expanded) {
      this.left_picker?.close()
      this.right_picker?.close()
    }
  }

  private dispatch_selection_changed (): void {
    const selection: PropSelection = {
      left: this.left_picker?.value ?? PropType.None,
      right: this.right_picker?.value ?? PropType.None
    }

    this.dispatchEvent(new CustomEvent<PropSelection>('props-selection-changed', { detail: selection }))
  }
}
