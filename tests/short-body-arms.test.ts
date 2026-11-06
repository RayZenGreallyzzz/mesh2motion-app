// @vitest-environment node
import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { estimate_arm_pose } from '../src/lib/processes/edit-skeleton/AutoRigArmPoseEstimator.ts'

it('separates a low bilateral T arm band from higher, wider ears', () => {
  const points: Vector3[] = []
  for (const y of [.72, .75, .78, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6]) {
    for (let x = -.9; x <= .9; x += .012) for (const z of [-.03, .03]) points.push(new Vector3(x, y, z))
  }
  const arm = estimate_arm_pose(points, 0, 1.8, 0, 1.9)!
  expect(arm.shortBody).toBe(true)
  expect(arm.shoulderY).toBeGreaterThan(.70)
  expect(arm.shoulderY).toBeLessThan(.80)
  expect(arm.handY).toBeCloseTo(arm.shoulderY, 1)
})

it('does not treat one wide appendage as two arms', () => {
  const points: Vector3[] = []
  for (let x = .3; x < 1; x += .005) for (let y = .65; y < .85; y += .01) points.push(new Vector3(x, y, 0))
  expect(estimate_arm_pose(points, 0, 2, 0, 2)).toBeNull()
})
