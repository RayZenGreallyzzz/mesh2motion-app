import { InterpolateLinear, Quaternion, Vector3 } from 'three'
import { detect_calibration_frame, MAX_MOTION_VALUES, validate_motion_document, type MotionDocument, type MotionTrack } from './MotionDocument.ts'

// Parse straight into typed arrays instead of allocating a JS frame object for
// every bone/sample. Kept in a worker for bounded mobile memory and cancellation.
export function parse_bvh_motion (text: string, name: string): MotionDocument {
  text = text.replace(/^\uFEFF/, '')
  const marker = /\bMOTION\b/.exec(text)
  if (!marker || marker.index > 1_000_000) throw new Error('В BVH не найден раздел MOTION')
  const tokens = text.slice(0, marker.index).match(/[^\s{}]+|[{}]/g) ?? [], channels: string[][] = []
  const doc: MotionDocument = { version: 1, format: 'bvh', name, nodes: [], clips: [], warnings: [] }
  let cursor = 0
  const take = () => { if (cursor >= tokens.length) throw new Error('Оборван заголовок BVH'); return tokens[cursor++] }
  const expect = (word: string) => { if (take() !== word) throw new Error('Некорректный BVH: ожидается ' + word) }
  const number = () => { const n = Number(take()); if (!Number.isFinite(n)) throw new Error('Некорректное число BVH'); return n }
  const read_node = (parent: number, depth: number, kind: string): void => {
    if (depth > 128 || doc.nodes.length >= 1024) throw new Error('Слишком большой скелет BVH')
    const end = kind === 'End'
    if (end) expect('Site')
    const node = { name: end ? 'EndSite_' + doc.nodes.length : take(), parent, joint: true, position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, index = doc.nodes.length
    doc.nodes.push(node); channels.push([]); expect('{'); expect('OFFSET'); node.position = [number(), number(), number()]
    if (!end) {
      expect('CHANNELS'); const count = number()
      if (!Number.isInteger(count) || count < 0 || count > 6) throw new Error('Некорректные каналы BVH')
      for (let i = 0; i < count; i++) { const ch = take(); if (!/^[XYZ](position|rotation)$/.test(ch) || channels[index].includes(ch)) throw new Error('Некорректный канал BVH'); channels[index].push(ch) }
    }
    for (let next = take(); next !== '}'; next = take()) {
      if (end || !['JOINT', 'End'].includes(next)) throw new Error('Повреждена иерархия BVH')
      read_node(index, depth + 1, next)
    }
  }
  expect('HIERARCHY'); expect('ROOT'); read_node(-1, 0, 'ROOT')
  if (cursor !== tokens.length) throw new Error('В BVH лишние узлы или несколько корней')
  const heading = /^MOTION\s+Frames\s*:\s*(\d+)\s+Frame\s+Time\s*:\s*([+.\deE-]+)\s*/.exec(text.slice(marker.index))
  if (!heading) throw new Error('Повреждены параметры кадров BVH')
  const frames = Number(heading[1]), step = Number(heading[2]), duration = (frames - 1) * step
  if (!Number.isInteger(frames) || frames < 1 || frames > 144001 || !Number.isFinite(step) || step <= 0 || step < 1 / 1000 || duration > 600) throw new Error('BVH: поддерживается до 10 минут и 1000 кадров/с')
  const width = channels.reduce((n, c) => n + (c.some(x => x.endsWith('position')) ? 4 : 0) + (c.some(x => x.endsWith('rotation')) ? 5 : 0), 0)
  if (frames * width > MAX_MOTION_VALUES) throw new Error('BVH слишком большой для одного движения. Разделите запись.')
  const times = Float32Array.from({ length: frames }, (_, i) => i * step), tracks: MotionTrack[] = []
  const positions = channels.map((c, node) => { if (!c.some(x => x.endsWith('position'))) return; const values = new Float32Array(frames * 3); tracks.push({ node, property: 'position', interpolation: InterpolateLinear, times, values }); return values })
  const rotations = channels.map((c, node) => { if (!c.some(x => x.endsWith('rotation'))) return; const values = new Float32Array(frames * 4); tracks.push({ node, property: 'quaternion', interpolation: InterpolateLinear, times, values }); return values })
  let offset = marker.index + heading[0].length
  const value = (): number => {
    while (offset < text.length && /\s/.test(text[offset])) offset++
    const start = offset; while (offset < text.length && !/\s/.test(text[offset])) offset++
    if (start === offset) throw new Error('В BVH не хватает кадров')
    const n = Number(text.slice(start, offset)); if (!Number.isFinite(n)) throw new Error('В BVH повреждён кадр'); return n
  }
  const axes = [new Vector3(1,0,0), new Vector3(0,1,0), new Vector3(0,0,1)], rotation = new Quaternion(), part = new Quaternion()
  for (let frame = 0; frame < frames; frame++) for (let node = 0; node < doc.nodes.length; node++) {
    rotation.identity(); const p = doc.nodes[node].position.slice()
    for (const ch of channels[node]) { const n = value(), axis = 'XYZ'.indexOf(ch[0]); if (ch.endsWith('position')) p[axis] += n; else rotation.multiply(part.setFromAxisAngle(axes[axis], n * Math.PI / 180)) }
    positions[node]?.set(p, frame * 3); rotations[node]?.set(rotation.toArray(), frame * 4)
  }
  if (text.slice(offset).trim()) throw new Error('В BVH лишние значения после последнего кадра')
  doc.clips = [{ name, duration: times[times.length - 1], tracks }]
  validate_motion_document(doc); doc.calibration_frame = detect_calibration_frame(doc); return doc
}
