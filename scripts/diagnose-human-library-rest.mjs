import fs from 'node:fs'
import path from 'node:path'

function parseGlb(file) {
  const data = fs.readFileSync(file)
  if (data.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB: ' + file)
  const jsonSize = data.readUInt32LE(12)
  const gltf = JSON.parse(data.toString('utf8', 20, 20 + jsonSize))
  return { gltf, bytes: data, binaryOffset: 20 + jsonSize + 8 }
}
function readVec4(parsed, accessorId) {
  const { gltf, bytes, binaryOffset } = parsed
  const a = gltf.accessors[accessorId]
  const v = gltf.bufferViews[a.bufferView]
  if (a.componentType !== 5126 || a.type !== 'VEC4') return null
  const ofs = binaryOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return [0, 1, 2, 3].map((i) => bytes.readFloatLE(ofs + i * 4))
}
function dist(a,b){ if(!a || !b) return null; return Math.hypot(...a.map((v,i)=>v-b[i])); }
const selected = ['root','pelvis','spine_01','spine_02','spine_03','clavicle_l','upperarm_l','lowerarm_l','forearm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','forearm_r','hand_r','thigh_l','thigh_r']
const rest = parseGlb('static/rigs/rig-human.glb')
const byName = new Map(rest.gltf.nodes.filter(n=>n.name).map(n=>[n.name,n]))
console.log('REFERENCE NODES',rest.gltf.nodes.length,'animations',rest.gltf.animations?.length ?? 0)
for(const file of ['static/animations/human-base-animations.glb','static/animations/human-addon-animations.glb','static/animations/human-mocap-animations.glb']){
  const asset = parseGlb(file), nodes = asset.gltf.nodes ?? []
  const names=new Map(nodes.filter(n=>n.name).map(n=>[n.name,n]))
  let count=0
  console.log('\nLIBRARY', path.basename(file),'nodes',nodes.length,'animations',asset.gltf.animations?.length??0,'skins',asset.gltf.skins?.length??0)
  for (const name of selected) {
    const n=names.get(name),r=byName.get(name)
    if (!n) continue
    count++
    const nr=n.rotation??[0,0,0,1],rr=r?.rotation??[0,0,0,1]
    const np=n.translation??[0,0,0],rp=r?.translation??[0,0,0]
    console.log(name,'restQuatDelta',dist(nr,rr)?.toFixed(5),'restPosDelta',dist(np,rp)?.toFixed(5), 'libQ',JSON.stringify(nr.map(x=>+x.toFixed(4))), 'refQ',JSON.stringify(rr.map(x=>+x.toFixed(4))))
  }
  const channels = asset.gltf.animations?.[0]?.channels??[],samplers=asset.gltf.animations?.[0]?.samplers??[]
  let firstFrames=[]
  for (const ch of channels) {
    const name = nodes[ch.target.node]?.name
    if (!selected.includes(name) || ch.target.path!=='rotation') continue
    const first=readVec4(asset,samplers[ch.sampler].output)
    if(first){firstFrames.push({name, first: first.map(x=>+x.toFixed(4)),rest: (names.get(name)?.rotation??[0,0,0,1]).map(x=>+x.toFixed(4))})}
  }
  console.log('FIRST_ANIMATION', asset.gltf.animations?.[0]?.name,JSON.stringify(firstFrames))
  console.log('TARGETED_NODES',count,'NODE_NAMES_SAMPLE', nodes.slice(0,15).map(n=>n.name).join(','))
}
