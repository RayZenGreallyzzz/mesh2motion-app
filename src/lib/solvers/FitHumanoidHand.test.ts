import { describe, expect, it } from 'vitest'
import { Bone, Vector3 } from 'three'
import { fit_humanoid_hand } from './FitHumanoidHand.ts'

describe('humanoid hand placement', () => {
  it('puts both hands inside A/T-pose palms while preserving the wrist and bone rotations', () => {
    for (const sign of [-1, 1]) {
      for (const angle of [0, Math.PI / 4]) {
        const direction = new Vector3(sign * Math.cos(angle), -Math.sin(angle), 0)
        const widthAxis = new Vector3(sign * Math.sin(angle), Math.cos(angle), 0)
        const wrist = new Vector3(sign * 0.6, 1.2, 0.1)
        const forearm = new Bone()
        forearm.position.copy(wrist).addScaledVector(direction, -0.25)
        const hand = new Bone()
        hand.position.copy(direction).multiplyScalar(0.25)
        forearm.add(hand)

        // The template fingers still point horizontally and its palm lies in
        // X/Z, even after AutoRig has moved the wrist into an A pose.
        const fingers: Bone[] = []
        for (const [name, spread] of [['index', 0.03], ['middle', 0], ['pinky', -0.03]] as const) {
          const base = new Bone(); base.name = `${name}_01`
          base.position.set(sign * 0.07, 0, spread)
          const tip = new Bone(); tip.name = `${name}_03`
          tip.position.set(sign * 0.09, 0, 0)
          base.add(tip); hand.add(base); fingers.push(base, tip)
        }
        forearm.updateWorldMatrix(true, true)
        const rotations = fingers.map(b => b.quaternion.clone())
        const points: Vector3[] = []
        for (let ring = 0; ring <= 20; ring++) {
          for (let sector = 0; sector < 16; sector++) {
            const theta = sector * Math.PI / 8
            points.push(wrist.clone().addScaledVector(direction, ring * 0.009)
              .addScaledVector(widthAxis, Math.cos(theta) * 0.035)
              .add(new Vector3(0, 0, Math.sin(theta) * 0.008)))
          }
        }

        fit_humanoid_hand(hand, forearm, points, 2)
        expect(hand.getWorldPosition(new Vector3()).distanceTo(wrist)).toBeLessThan(1e-8)
        const middle = fingers[2].getWorldPosition(new Vector3()).sub(wrist).normalize()
        expect(middle.dot(direction)).toBeGreaterThan(0.99)
        const across = fingers[0].getWorldPosition(new Vector3())
          .sub(fingers[4].getWorldPosition(new Vector3())).normalize()
        expect(Math.abs(across.dot(widthAxis))).toBeGreaterThan(0.99)
        fingers.forEach((bone, i) => {
          const offset = bone.getWorldPosition(new Vector3()).sub(wrist)
          expect(offset.dot(direction)).toBeGreaterThan(0)
          expect(offset.length()).toBeLessThan(0.18)
          expect(Math.abs(offset.z)).toBeLessThan(0.008)
          expect(bone.quaternion.equals(rotations[i])).toBe(true)
        })
      }
    }
  })

  it('leaves the template intact when no usable hand surface is available', () => {
    const forearm = new Bone(); const hand = new Bone(); const middle = new Bone()
    forearm.add(hand); hand.add(middle)
    hand.position.x = 0.5; middle.name = 'middle_01'; middle.position.x = 0.1
    const original = middle.position.clone()
    fit_humanoid_hand(hand, forearm, [], 2)
    expect(middle.position.equals(original)).toBe(true)
  })
})
