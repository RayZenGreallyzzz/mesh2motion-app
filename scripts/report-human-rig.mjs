import fs from 'node:fs'
import path from 'node:path'

function parseGlbJson(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`Not a GLB: ${filePath}`)
  }
  const version = buf.readUInt32LE(4)
  const totalLength = buf.readUInt32LE(8)
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}: ${filePath}`)
  if (totalLength > buf.length) throw new Error(`Truncated GLB: ${filePath}`)

  let offset = 12
  while (offset + 8 <= totalLength) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    offset += 8
    const chunk = buf.subarray(offset, offset + chunkLength)
    offset += chunkLength
    if (chunkType === 0x4E4F534A) {
      const text = chunk.toString('utf8').replace(/\u0000+$/g, '').trimEnd()
      return JSON.parse(text)
    }
  }
  throw new Error(`JSON chunk not found: ${filePath}`)
}

function nodeParentMap(nodes = []) {
  const parents = new Map()
  nodes.forEach((node, parentIndex) => {
    for (const childIndex of node.children ?? []) parents.set(childIndex, parentIndex)
  })
  return parents
}

function summarizeRig(filePath) {
  const json = parseGlbJson(filePath)
  const nodes = json.nodes ?? []
  const parents = nodeParentMap(nodes)
  const jointIndices = new Set((json.skins ?? []).flatMap(s => s.joints ?? []))

  return {
    file: filePath,
    asset: json.asset,
    scene: json.scene,
    scenes: json.scenes,
    skins: (json.skins ?? []).map((skin, index) => ({
      index,
      name: skin.name ?? null,
      skeleton: skin.skeleton ?? null,
      skeletonName: skin.skeleton != null ? (nodes[skin.skeleton]?.name ?? null) : null,
      inverseBindMatrices: skin.inverseBindMatrices ?? null,
      joints: (skin.joints ?? []).map(i => ({ index: i, name: nodes[i]?.name ?? null }))
    })),
    joints: [...jointIndices].map(i => {
      const node = nodes[i] ?? {}
      const parent = parents.get(i)
      return {
        index: i,
        name: node.name ?? null,
        parent: parent ?? null,
        parentName: parent != null ? (nodes[parent]?.name ?? null) : null,
        children: (node.children ?? []).map(c => ({ index: c, name: nodes[c]?.name ?? null })),
        translation: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
        matrix: node.matrix ?? null
      }
    }),
    allNodeNames: nodes.map((n, i) => ({ index: i, name: n.name ?? null }))
  }
}

function summarizeAnimations(filePath) {
  const json = parseGlbJson(filePath)
  const nodes = json.nodes ?? []
  const animations = (json.animations ?? []).map((anim, animationIndex) => {
    const channels = (anim.channels ?? []).map((channel, channelIndex) => {
      const targetNode = channel.target?.node
      const sampler = anim.samplers?.[channel.sampler]
      return {
        channelIndex,
        sampler: channel.sampler,
        targetNode: targetNode ?? null,
        targetName: targetNode != null ? (nodes[targetNode]?.name ?? null) : null,
        path: channel.target?.path ?? null,
        inputAccessor: sampler?.input ?? null,
        outputAccessor: sampler?.output ?? null,
        interpolation: sampler?.interpolation ?? 'LINEAR'
      }
    })
    const targetNames = [...new Set(channels.map(c => c.targetName).filter(Boolean))]
    const targetPaths = [...new Set(channels.map(c => c.path).filter(Boolean))]
    return {
      animationIndex,
      name: anim.name ?? `animation-${animationIndex}`,
      channelCount: channels.length,
      targetNames,
      targetPaths,
      channels
    }
  })
  const allTargets = [...new Set(animations.flatMap(a => a.targetNames))].sort()
  return { file: filePath, animationCount: animations.length, allTargets, animations }
}

const rigPath = 'static/rigs/rig-human.glb'
const animationCandidates = [
  'static/animations/human-base-animations.glb',
  'static/animations/human-addon-animations.glb',
  'static/animations/human-mocap-animations.glb'
]

const report = {
  generatedAt: new Date().toISOString(),
  rig: summarizeRig(rigPath),
  animationLibraries: animationCandidates.filter(fs.existsSync).map(summarizeAnimations)
}
report.allAnimationTargetNames = [...new Set(report.animationLibraries.flatMap(x => x.allTargets))].sort()
report.missingAnimationFiles = animationCandidates.filter(p => !fs.existsSync(p))

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/human-rig-report.json', JSON.stringify(report, null, 2) + '\n')
console.log(`Wrote reports/human-rig-report.json with ${report.rig.joints.length} joints and ${report.animationLibraries.reduce((sum, x) => sum + x.animationCount, 0)} animations.`)
console.log('Animation targets:', report.allAnimationTargetNames.join(', '))
