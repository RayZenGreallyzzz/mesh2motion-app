import { Vector3, type Bone, type Box3 } from 'three'
import { validate_head_landmarks, type HeadPoint } from './HumanoidHeadReview.ts'

export const body_landmarks = {
  chin: ['Подбородок', '#c29cff'],
  pelvis: ['Таз', '#ff72a5'],
  hand_l: ['Левая кисть', '#4bcdfa'],
  hand_r: ['Правая кисть', '#4bcdfa'],
  lowerarm_l: ['Левый локоть', '#ffad51'],
  lowerarm_r: ['Правый локоть', '#ffad51'],
  calf_l: ['Левое колено', '#80eb72'],
  calf_r: ['Правое колено', '#80eb72']
} as const
export type BodyLandmark = keyof typeof body_landmarks
export type BodyPoints = Record<BodyLandmark, HeadPoint>
export type BodyCorrections = Partial<BodyPoints>
export const body_keys = Object.keys(body_landmarks) as BodyLandmark[]
const pairs = [['hand_l', 'hand_r'], ['lowerarm_l', 'lowerarm_r'], ['calf_l', 'calf_r']] as const
const partner = new Map<BodyLandmark, BodyLandmark>(pairs.flatMap(([left, right]) => [[left, right], [right, left]]))
type FindBone = (name: string) => Bone
type PlaceBone = (bone: Bone, point: Vector3) => void
const vertical = new Vector3(0, 1, 0)
const coord = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())

export class HumanoidBodyReviewRequired extends Error {
  readonly points: BodyPoints
  readonly edited = new Set<BodyLandmark>()
  constructor(readonly initial: BodyPoints, readonly surface: Float32Array, readonly yaw: number, readonly height: number) {
    super('Расставьте восемь точек тела.')
    this.points = structuredClone(initial)
  }

  reset (): void {
    Object.assign(this.points, structuredClone(this.initial))
    this.edited.clear()
  }

  corrections (): BodyCorrections | undefined {
    if (!this.edited.size) return undefined
    return Object.fromEntries([...this.edited].map(name => [name, [...this.points[name]]]))
  }
}

/** Work in the fitted character's frontal frame to make depth independent
 * of the viewing camera and of the imported character's yaw. */
export function sample_body_depth (points: Vector3[], yaw: number): Float32Array {
  const stride = Math.max(1, Math.ceil(points.length / 28000))
  const cloud = new Float32Array(Math.ceil(points.length / stride) * 3)
  const p = new Vector3()
  for (let i = 0; i < points.length; i += stride) {
    p.copy(points[i]).applyAxisAngle(vertical, -yaw).toArray(cloud, i / stride * 3)
  }
  return cloud
}

export function automatic_body_depth (review: HumanoidBodyReviewRequired, name: BodyLandmark, point: HeadPoint): HeadPoint {
  const p = new Vector3(...point).applyAxisAngle(vertical, -review.yaw)
  const seed = new Vector3(...review.initial[name]).applyAxisAngle(vertical, -review.yaw)
  const arm = name.startsWith('hand_') || name.startsWith('lowerarm_')
  let radius = review.height * .018
  let depth_window = review.height * .12
  if (name === 'pelvis') depth_window = review.height * .20
  if (arm) depth_window = review.height * .055
  const z: number[] = []
  for (let pass = 0; pass < 2 && z.length < 8; pass++, radius *= 1.65) {
    z.length = 0
    for (let i = 0; i < review.surface.length; i += 3) {
      const d = review.surface[i + 2]
      if (Math.abs(d - seed.z) <= depth_window &&
        (review.surface[i] - p.x) ** 2 + (review.surface[i + 1] - p.y) ** 2 <= radius * radius) z.push(d)
    }
  }
  p.z = seed.z
  if (z.length >= 8) {
    z.sort((a, b) => a - b)
    const quantile = (fraction: number) => z[Math.round((z.length - 1) * fraction)]
    const estimated = name === 'chin' ? quantile(.84) : (quantile(.12) + quantile(.88)) / 2
    // Nearby hair or equipment can cross the projected arm; a small screen
    // correction must not move the joint far from its fitted depth.
    let limit = review.height * (name === 'pelvis' ? .10 : .08)
    if (arm) limit = Math.min(review.height * .035, Math.hypot(p.x - seed.x, p.y - seed.y) * .65)
    p.z = Math.max(seed.z - limit, Math.min(seed.z + limit, estimated))
  }
  return p.applyAxisAngle(vertical, review.yaw).toArray()
}

function project_body_point (review: HumanoidBodyReviewRequired, point: HeadPoint, amount: number): HeadPoint {
  const lateral = new Vector3(1, 0, 0).applyAxisAngle(vertical, review.yaw)
  const origin = new Vector3(...review.initial.pelvis), target = new Vector3(...point)
  return target.addScaledVector(lateral, -amount * target.clone().sub(origin).dot(lateral)).toArray()
}

/** Match both halves in the fitted body's frame. A model's own midline
 * remains the mirror plane when the camera turns or the pelvis marker moves. */
export function mirror_body_points (review: HumanoidBodyReviewRequired): void {
  for (const [left, right] of pairs) {
    if (!review.edited.has(left) && !review.edited.has(right)) continue
    const fromRight = project_body_point(review, review.points[right], 2)
    if (!review.edited.has(left)) review.points[left] = fromRight
    else if (review.edited.has(right)) {
      review.points[left] = new Vector3(...review.points[left]).lerp(new Vector3(...fromRight), .5).toArray()
    }
    review.points[right] = project_body_point(review, review.points[left], 2)
    review.edited.add(left); review.edited.add(right)
  }
  for (const name of ['chin', 'pelvis'] as const) {
    if (review.edited.has(name)) review.points[name] = project_body_point(review, review.points[name], 1)
  }
}

export function move_body_point (review: HumanoidBodyReviewRequired, name: BodyLandmark, point: HeadPoint, mirror: boolean): void {
  const other = partner.get(name)
  const target = mirror && !other ? project_body_point(review, point, 1) : point
  const adjusted = automatic_body_depth(review, name, target)
  review.points[name] = adjusted
  review.edited.add(name)
  if (mirror && other) {
    review.points[other] = project_body_point(review, adjusted, 2)
    review.edited.add(other)
  }
}

export function suggested_body_points (get: FindBone, yaw: number, height: number): BodyPoints {
  const head = coord(get('head')), tip = coord(get('head_leaf'))
  const skull = Math.max(tip.y - head.y, height * .03)
  const chin = head.clone().addScaledVector(new Vector3(0,0,1).applyAxisAngle(vertical, yaw), skull * .40)
  chin.y -= .09 * skull
  return Object.fromEntries(body_keys.map(name => [name, name === 'chin' ? chin.toArray() : coord(get(name)).toArray()])) as BodyPoints
}

export function apply_body_points (
  get: FindBone, place: PlaceBone, points: BodyCorrections, suggested: BodyPoints, bounds: Box3, yaw: number,
  headReviewed: boolean
): void {
  const height = bounds.max.y - bounds.min.y
  const margin = bounds.clone().expandByScalar(height * .06)
  for (const name of body_keys) {
    const p = points[name]
    if (p && (!p.every(Number.isFinite) || !margin.containsPoint(new Vector3(...p)))) {
      throw new Error(body_landmarks[name][0] + ' находится за пределами модели.')
    }
  }
  const at = (name: BodyLandmark) => new Vector3(...(points[name] ?? suggested[name]))
  const lateral = new Vector3(1, 0, 0).applyAxisAngle(vertical, yaw)
  for (const [left, right] of pairs) {
    if ((points[left] || points[right]) && at(left).sub(at(right)).dot(lateral) <= height * .004) {
      throw new Error('Проверьте левую и правую точки. ' + body_landmarks[left][0] + ' и ' + body_landmarks[right][0] + ' должны быть по своим сторонам.')
    }
  }
  for (const side of ['l','r'] as const) {
    if (points[`calf_${side}`] || points.pelvis) {
      const knee = at(`calf_${side}`)
      if (knee.y >= at('pelvis').y - height * .060 || knee.y <= coord(get('foot_' + side)).y + height * .050) {
        throw new Error('Поставьте колено между тазом и лодыжкой.')
      }
    }
    if (points[`lowerarm_${side}`] || points[`hand_${side}`]) {
      const elbow = at(`lowerarm_${side}`)
      if (elbow.distanceTo(at(`hand_${side}`)) < height * .025 ||
          elbow.distanceTo(coord(get('upperarm_' + side))) < height * .025) {
        throw new Error('Разведите метки кисти и локтя.')
      }
    }
  }

  // The AutoRig already fitted shoulders, ankles and fingers. Compensate
  // translations on children so a marker only changes its own pivot.
  for (const name of body_keys) {
    if (name === 'chin' || !points[name]) continue
    const joint = get(name)
    const children = (joint.children as Bone[]).filter(child => child.isBone)
      .map(child => ({ child, position: coord(child) }))
    place(joint, at(name))
    for (const { child, position } of children) place(child, position)
  }

  if (!points.chin || headReviewed) return
  // The chin is a surface marker, while both deforming pivots are internal.
  // Preserve their fitted depth and move only by the in-plane correction.
  const adjustment = at('chin').sub(new Vector3(...suggested.chin))
  const forward = new Vector3(0, 0, 1).applyAxisAngle(vertical, yaw)
  adjustment.addScaledVector(forward, -adjustment.dot(forward))
  const head = {
    neck: coord(get('neck_01')).addScaledVector(adjustment, .42).toArray(),
    head: coord(get('head')).add(adjustment).toArray(),
    head_end: coord(get('head_leaf')).add(adjustment).toArray()
  }
  validate_head_landmarks(head, bounds)
  place(get('neck_01'), new Vector3(...head.neck))
  place(get('head'), new Vector3(...head.head))
  place(get('head_leaf'), new Vector3(...head.head_end))
}
