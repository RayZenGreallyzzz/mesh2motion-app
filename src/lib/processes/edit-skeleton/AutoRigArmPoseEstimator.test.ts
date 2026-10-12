import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { estimate_arm_pose } from './AutoRigArmPoseEstimator'

function silhouette (innerY: number, handY: number): Vector3[] {
  const points: Vector3[] = [
    new Vector3(0, -0.953, 0), // boot bottom
    new Vector3(0, 0.948, 0), // huge ears above cat head
    new Vector3(-0.718, handY, 0),
    new Vector3(0.708, handY, 0)
  ]
  for (const side of [-1, 1]) {
    for (let i = 0; i < 40; i++) {
      points.push(new Vector3(side * (0.41 + 0.0001 * i), innerY + (i % 3 - 1) * 0.01, 0))
      points.push(new Vector3(side * (0.65 + 0.0001 * i), handY + (i % 3 - 1) * 0.01, 0))
      // A wide furry cape below the torso must not count as an arm.
      points.push(new Vector3(side * (0.46 + 0.0001 * i), -0.34, -0.3))
    }
  }
  return points
}

describe('AutoRig arm pose with ears and hip-level clothing', () => {
  it('recognises a true T-pose even when shoulder Y is well below 79% of model height', () => {
    const result = estimate_arm_pose(silhouette(0.434, 0.417), 0, 1.426, -0.953, 1.901)
    expect(result).not.toBeNull()
    expect(result!.tPose).toBe(true)
    expect(result!.shoulderY).toBeCloseTo(0.434, 2)
    expect(result!.handY).toBeCloseTo(0.417, 2)
    expect(result!.handY).toBeGreaterThan(0.35) // old A-pose forced it to ~0.188
  })

  it('distinguishes sloping A-pose from real horizontal arms', () => {
    const result = estimate_arm_pose(silhouette(0.434, 0.17), 0, 1.426, -0.953, 1.901)
    expect(result).not.toBeNull()
    expect(result!.tPose).toBe(false)
    expect(result!.handY).toBeCloseTo(0.17, 2)
  })

  it('keeps the original fallback available when arm geometry is absent', () => {
    const result = estimate_arm_pose([new Vector3(0, 0, 0)], 0, 1.426, -0.953, 1.901)
    expect(result).toBeNull()
  })
})
