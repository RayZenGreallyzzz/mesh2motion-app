import { readFileSync, statSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'

export function verifyPhoenixCatalog(root = 'dist', catalogPath = 'src/library/phoenix-packs.json') {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const base = resolve(root), ids = new Set(), paths = new Set(), summary = []
  for (const pack of catalog) {
    if (ids.has(pack.id) || paths.has(pack.path)) throw new Error('Duplicate pack in catalog: ' + pack.id)
    ids.add(pack.id); paths.add(pack.path)
    const path = resolve(base, pack.path)
    if (relative(base, path).startsWith('..' + sep) || relative(base, path) === '..') throw new Error('Unsafe pack path')
    let bytes
    try { bytes = readFileSync(path) } catch { throw new Error('Missing built-in library file: ' + pack.path) }
    if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB: ' + pack.path)
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
    if ((document.animations?.length ?? 0) !== pack.clips) throw new Error('Animation count mismatch: ' + pack.id)
    const bones = new Set(document.skins?.flatMap(s => s.joints) ?? [])
    if (bones.size !== pack.bones) throw new Error('Skeleton count mismatch: ' + pack.id)
    if (!document.meshes?.length || !document.skins?.length) throw new Error('Pack has no skinned model: ' + pack.id)
    for (const buffer of document.buffers ?? []) if (buffer.uri && !buffer.uri.startsWith('data:')) throw new Error('External buffer in offline pack: ' + pack.id)
    for (const image of document.images ?? []) if (image.bufferView === undefined && !image.uri?.startsWith('data:')) throw new Error('External texture in offline pack: ' + pack.id)
    const clipNames = new Set()
    for (const clip of document.animations) {
      if (!clip.name || clipNames.has(clip.name)) throw new Error('Missing or duplicate animation name: ' + pack.id)
      clipNames.add(clip.name)
      if (!clip.channels?.length) throw new Error('Empty animation: ' + pack.id + '/' + clip.name)
    }
    summary.push({ id: pack.id, clips: pack.clips, bones: bones.size, bytes: statSync(path).size })
  }
  return { packs: summary.length, clipsIncludingRootMotionVariants: summary.reduce((n, p) => n + p.clips, 0), bytes: summary.reduce((n, p) => n + p.bytes, 0), files: summary }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const report = verifyPhoenixCatalog(process.argv[2] ?? 'dist', process.argv[3])
  console.log(JSON.stringify(report, null, 2))
}
