import { Vector3, type Bone, type Box3 } from 'three'
import { capture_hand_shape, place_hand_shape } from '../lib/processes/edit-skeleton/HandPose.ts'
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
export const body_keys = Object.keys(body_landmarks) as BodyLandmark[]
const pairs = [['hand_l', 'hand_r'], ['lowerarm_l', 'lowerarm_r'], ['calf_l', 'calf_r']] as const
const partner = new Map<BodyLandmark, BodyLandmark>(pairs.flatMap(([left, right]) => [[left, right], [right, left]]))
type FindBone = (name: string) => Bone
type PlaceBone = (bone: Bone, point: Vector3) => void
const vertical = new Vector3(0, 1, 0)
const coord = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())

export class HumanoidBodyReviewRequired extends Error {
  readonly points: BodyPoints
  constructor(readonly initial: BodyPoints, readonly surface: Float32Array, readonly yaw: number, readonly height: number) {
    super('Расставьте восемь точек тела.')
    this.points = structuredClone(initial)
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
  let radius = review.height * .018
  const depth_window = review.height * (name === 'pelvis' ? .20 : .12)
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
    const limit = review.height * (name === 'pelvis' ? .10 : .08)
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
    review.points[left] = new Vector3(...review.points[left])
      .lerp(new Vector3(...project_body_point(review, review.points[right], 2)), .5).toArray()
    review.points[right] = project_body_point(review, review.points[left], 2)
  }
  for (const name of ['chin', 'pelvis'] as const) review.points[name] = project_body_point(review, review.points[name], 1)
}

export function move_body_point (review: HumanoidBodyReviewRequired, name: BodyLandmark, point: HeadPoint, mirror: boolean): void {
  const other = partner.get(name)
  const target = mirror && !other ? project_body_point(review, point, 1) : point
  const adjusted = automatic_body_depth(review, name, target)
  review.points[name] = adjusted
  if (mirror && other) review.points[other] = project_body_point(review, adjusted, 2)
}

export function suggested_body_points (get: FindBone, yaw: number, height: number): BodyPoints {
  const head = coord(get('head')), tip = coord(get('head_leaf'))
  const skull = Math.max(tip.y - head.y, height * .03)
  const chin = head.clone().addScaledVector(new Vector3(0,0,1).applyAxisAngle(vertical, yaw), skull * .40)
  chin.y -= .09 * skull
  return Object.fromEntries(body_keys.map(name => [name, name === 'chin' ? chin.toArray() : coord(get(name)).toArray()])) as BodyPoints
}

export function apply_body_points (
  get: FindBone, place: PlaceBone, points: BodyPoints, suggested: BodyPoints, bounds: Box3, yaw: number
): void {
  const height = bounds.max.y - bounds.min.y
  const margin = bounds.clone().expandByScalar(height * .06)
  for (const name of body_keys) {
    const p = points[name]
    if (!p || !p.every(Number.isFinite) || !margin.containsPoint(new Vector3(...p))) {
      throw new Error(body_landmarks[name][0] + ' находится за пределами модели.')
    }
  }
  const at = (name: BodyLandmark) => new Vector3(...points[name])
  const lateral = new Vector3(1, 0, 0).applyAxisAngle(vertical, yaw)
  for (const [left, right] of [['hand_l', 'hand_r'], ['lowerarm_l', 'lowerarm_r'], ['calf_l', 'calf_r']] as const) {
    if (at(left).sub(at(right)).dot(lateral) <= height * .004) {
      throw new Error('Проверьте левую и правую точки. ' + body_landmarks[left][0] + ' и ' + body_landmarks[right][0] + ' должны быть по своим сторонам.')
    }
  }
  for (const side of ['l','r'] as const) {
    const knee = at(`calf_${side}`), elbow = at(`lowerarm_${side}`)
    if (knee.y >= at('pelvis').y - height * .060 || knee.y <= coord(get('foot_' + side)).y + height * .050) {
      throw new Error('Поставьте колено между тазом и лодыжкой.')
    }
    if (elbow.distanceTo(at(`hand_${side}`)) < height * .025 ||
        elbow.distanceTo(coord(get('upperarm_' + side))) < height * .025) {
      throw new Error('Разведите метки кисти и локтя.')
    }
  }

  const pelvis = get('pelvis'), spine = get('spine_01')
  const offset = at('pelvis').sub(coord(pelvis)), chest = coord(spine)
  const legs = (['l','r'] as const).map(side => {
    const thigh = get('thigh_' + side), foot = get('foot_' + side)
    return { thigh, foot, start: coord(thigh).add(offset), ankle: coord(foot), side }
  })
  place(pelvis, at('pelvis')); place(spine, chest)
  for (const {thigh, foot, start, ankle, side} of legs) {
    place(thigh, start); place(get('calf_' + side), at(`calf_${side}`)); place(foot, ankle)
    const elbow = get('lowerarm_' + side), hand = get('hand_' + side)
    const fingers = capture_hand_shape(hand, elbow)
    place(elbow, at(`lowerarm_${side}`)); place(hand, at(`hand_${side}`))
    place_hand_shape(hand, fingers, coord(hand).sub(coord(elbow)))
  }

  // The chin is an external marker; translate the fitted neck/skull anchors
  // by its correction so the head pivot stays inside the skull.
  const adjustment = at('chin').sub(new Vector3(...suggested.chin))
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
