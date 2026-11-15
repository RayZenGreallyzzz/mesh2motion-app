import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three'
import { body_keys, body_landmarks, type BodyLandmark, type BodyPoints } from './HumanoidBodyLandmarks.ts'
import type { HeadPoint } from './HumanoidHeadReview.ts'

export interface BodyOverlayState {
  points: BodyPoints
  active: BodyLandmark
  editable: boolean
  select(name: BodyLandmark): void
  move(name: BodyLandmark, point: HeadPoint): void
}

/** Fixed-size hit areas keep the guides touchable at every camera zoom. */
export class BodyLandmarkOverlay {
  private readonly layer = document.createElement('div')
  private readonly buttons = new Map<BodyLandmark, HTMLButtonElement>()
  private readonly ray = new Raycaster()
  private state?: BodyOverlayState
  private drag?: { name: BodyLandmark, id: number, plane: Plane, offset: Vector3 }

  constructor (container: HTMLElement, private readonly camera: Camera) {
    this.layer.className = 'body-landmarks'
    this.layer.setAttribute('aria-label', 'Ориентиры тела на модели')
    this.layer.hidden = true
    for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
      this.layer.addEventListener(type, event => event.preventDefault())
    }
    container.append(this.layer)
    for (const name of body_keys) {
      const [label, color] = body_landmarks[name]
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'body-landmark-handle'
      const marker = document.createElement('span')
      marker.className = 'body-landmark-ring'; marker.setAttribute('aria-hidden', 'true')
      button.append(marker)
      button.setAttribute('aria-label', label); button.style.setProperty('--landmark-color', color)
      // Keyboard activation still chooses the named control.
      button.onclick = event => { if (event.detail === 0) this.state?.select(name) }
      button.onpointerdown = event => this.start(button, name, event)
      button.onpointermove = event => this.move(event)
      const finish = (event: PointerEvent): void => {
        if (this.drag?.id === event.pointerId) this.drag = undefined
      }
      button.onpointerup = button.onpointercancel = button.onlostpointercapture = finish
      this.buttons.set(name, button); this.layer.append(button)
    }
  }

  update (state?: BodyOverlayState): void {
    if (!state?.editable) this.drag = undefined
    this.state = state; this.layer.hidden = !state
    if (!state) return
    for (const [name, button] of this.buttons) {
      button.setAttribute('aria-pressed', String(state.active === name))
      button.classList.toggle('readonly', !state.editable)
    }
    this.project()
  }

  project (): void {
    if (!this.state) return
    const width = this.layer.clientWidth, height = this.layer.clientHeight
    if (!width || !height) return
    const point = new Vector3()
    for (const [name, button] of this.buttons) {
      point.fromArray(this.state.points[name]).project(this.camera)
      const x = (point.x + 1) * width * .5, y = (1 - point.y) * height * .5
      button.hidden = point.z < -1 || point.z > 1 || x < 0 || y < 0 || x > width || y > height
      button.style.left = x + 'px'; button.style.top = y + 'px'
    }
  }

  private hit (event: PointerEvent, plane: Plane): Vector3 | null {
    const r = this.layer.getBoundingClientRect()
    if (!r.width || !r.height) return null
    this.ray.setFromCamera(new Vector2(
      (event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2
    ), this.camera)
    return this.ray.ray.intersectPlane(plane, new Vector3())
  }

  private closest (event: PointerEvent, fallback: BodyLandmark): BodyLandmark {
    const { left, top } = this.layer.getBoundingClientRect()
    let closest = fallback, distance = Infinity
    for (const [name, button] of this.buttons) {
      if (button.hidden) continue
      const next = (event.clientX - left - parseFloat(button.style.left)) ** 2 +
        (event.clientY - top - parseFloat(button.style.top)) ** 2
      if (next < distance || (next === distance && name === this.state?.active)) {
        closest = name; distance = next
      }
    }
    return closest
  }

  private start (button: HTMLButtonElement, fallback: BodyLandmark, event: PointerEvent): void {
    if (!this.state || this.drag || event.button !== 0) return
    event.preventDefault()
    const name = this.closest(event, fallback)
    this.state.select(name)
    if (!this.state.editable) return
    const point = new Vector3(...this.state.points[name])
    const plane = new Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new Vector3()), point)
    const hit = this.hit(event, plane)
    if (!hit) return
    this.drag = { name, id: event.pointerId, plane, offset: point.sub(hit) }
    button.setPointerCapture(event.pointerId)
  }

  private move (event: PointerEvent): void {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId || !this.state?.editable) return
    const hit = this.hit(event, drag.plane)
    if (hit) this.state.move(drag.name, hit.add(drag.offset).toArray())
  }
}
