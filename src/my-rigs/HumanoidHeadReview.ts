import { Box3, Vector3 } from 'three'

/** Coordinates are in the original GLB world frame, before viewer reflection. */
export type HeadPoint = [number, number, number]
export interface HeadLandmarks { neck: HeadPoint, head: HeadPoint, head_end: HeadPoint }
export class HumanoidHeadReviewRequired extends Error {
  constructor(readonly points: HeadLandmarks) {
    super('Проверьте шею, основание головы и макушку спереди и сбоку, затем продолжите расчёт. Исходный персонаж сохранён.')
    this.name = 'HumanoidHeadReviewRequired'
  }
}
export function validate_head_landmarks(points: HeadLandmarks, bounds: Box3): void {
  const size = bounds.getSize(new Vector3()).length(), region = bounds.clone().expandByScalar(size * .12)
  const values: HeadPoint[] = [points.neck, points.head, points.head_end]
  if (!(size > 1e-8) || values.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !region.containsPoint(new Vector3(...p))))
    throw new Error('Ориентиры головы должны находиться рядом с поверхностью персонажа и содержать конечные координаты.')
  const [neck, head, tip] = values.map(p => new Vector3(...p)), neckLength = neck.distanceTo(head), skullLength = head.distanceTo(tip)
  if (!(neck.y < head.y && head.y < tip.y) || neckLength < size * .003 || skullLength < size * .01 || neckLength > size * .3 || skullLength > size * .55)
    throw new Error('Поставьте шею ниже основания головы, а макушку выше. Проверьте длину шеи и головы.')
}
