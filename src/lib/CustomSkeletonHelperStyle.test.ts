import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bone, InstancedMesh, Texture, TextureLoader } from 'three'
import { CustomSkeletonHelper } from './CustomSkeletonHelper'

describe('Meshy-inspired rig preview is visual-only', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows rounded joints, can revert, and preserves all real Bone transforms', () => {
    vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture())
    const root = new Bone()
    root.name = 'root'
    const upper = new Bone()
    upper.name = 'upperarm_l'
    upper.position.set(-0.2, 1.3, 0)
    const forearm = new Bone()
    forearm.name = 'lowerarm_l'
    forearm.position.set(-0.35, 0, 0)
    root.add(upper)
    upper.add(forearm)
    root.updateMatrixWorld(true)

    const before = [root, upper, forearm].map(b => ({
      position: b.position.toArray(),
      rotation: b.quaternion.toArray(),
      scale: b.scale.toArray()
    }))
    const helper = new CustomSkeletonHelper(root)
    const classic = helper.geometry
    helper.setJointVisualization('meshy')
    helper.updateMatrixWorld(true)

    expect(helper.geometry).not.toBe(classic)
    expect(helper.geometry.getAttribute('color').count).toBeGreaterThan(0)
    const ball = helper.children.find(c => c instanceof InstancedMesh) as InstancedMesh
    expect(ball).toBeDefined()
    expect(ball.visible).toBe(true)
    expect(ball.count).toBe(3)
    helper.setJointsVisible(false)
    expect(ball.visible).toBe(false)
    helper.setJointsVisible(true)
    expect(ball.visible).toBe(true)

    helper.setJointVisualization('classic')
    expect(helper.geometry).toBe(classic)
    expect(ball.visible).toBe(false)
    helper.setJointVisualization('meshy')
    expect(ball.visible).toBe(true)
    expect([root, upper, forearm].map(b => ({
      position: b.position.toArray(),
      rotation: b.quaternion.toArray(),
      scale: b.scale.toArray()
    }))).toEqual(before)
    helper.dispose()
  })
})
