import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { estimate_arm_pose, estimate_wrist_reach } from './AutoRigArmPoseEstimator'

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

describe('AutoRig wrist placement', () => {
  it('locates wrist constriction before the wide palm and outstretched fingertips', () => {
    const points: Vector3[] = []
    const width = 1.425
    for (const reach of [0.70, 0.74, 0.78, 0.82, 0.85, 0.96, 1]) {
      const size = reach === 0.74 ? 0.030 : reach >= 0.96 ? 0.075 : 0.110
      for (let i = 0; i < 48; i++) {
        points.push(new Vector3(
          reach * width * 0.5,
          0.42 + (i % 3 - 1) * 0.008,
          (i / 47 - 0.5) * size
        ))
      }
    }
    const reach = estimate_wrist_reach(points, 0, width, -0.953, 1.901, 1, 0.434, 0.417)
    expect(reach).toBeCloseTo(0.74, 2)
    expect(reach).toBeLessThan(0.86) // previous AutoRig was 0.91, almost at the fingertips
  })

  it('uses safe wrist reach without enough geometry data', () => {
    const r = estimate_wrist_reach([], 0, 1.425, -0.953, 1.901, 1, 0.434, 0.417)
    expect(r).toBe(0.78)
  })
})
