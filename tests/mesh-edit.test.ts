// @vitest-environment node
import { Bone, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { brush_selection, cut_selection, deform_selection, is_bind_face, tint_selection } from '../src/my-rigs/MeshEditGeometry.ts'
import { write_mesh_edits } from '../src/my-rigs/MeshEditGlb.ts'
import { load_fit_surface, verify_original_for_fit } from '../src/my-rigs/RigFitReference.ts'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const geometry_of = (positions: number[], indices: number[]) =>
  new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)).setIndex(indices)

describe('model editing', () => {
  it('allows a bound quantized model with submillimetre rounding and still detects a real pose change', () => {
    const geometry = new BufferGeometry().setAttribute('position', new Uint16BufferAttribute([
      10000,10000,0, 20000,10000,0, 10000,20000,0
    ], 3))
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(12).fill(0),4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
    const scene = new Group(), bone = new Bone(), mesh = new SkinnedMesh(geometry)
    mesh.scale.setScalar(.0001)
    scene.add(mesh,bone)
    scene.updateMatrixWorld(true)
    mesh.bind(new Skeleton([bone]))
    const face = {a:0,b:1,c:2}
    bone.position.z = .000025
    scene.updateMatrixWorld(true)
    expect(mesh.getVertexPosition(0,new Vector3()).distanceTo(new Vector3(10000,10000,0))).toBeGreaterThan(.2)
    expect(is_bind_face(mesh,face,.0002)).toBe(true)
    bone.position.z = .01
    scene.updateMatrixWorld(true)
    expect(is_bind_face(mesh,face,.0002)).toBe(false)
  })

  it('connects UV seams while leaving another nearby surface outside the brush', () => {
    const geometry = geometry_of([
      0,0,0, 1,0,0, 0,1,0, 1,0,0, 1,1,0, 0,1,0,
      0,0,.02, 1,0,.02, 0,1,.02
    ], [0,1,2, 3,4,5, 6,7,8])
    const hit = {a:0,b:1,c:2}
    const selection = brush_selection(geometry, new Matrix4(), new Vector3(.5,.5,0), hit, 1)
    expect([...selection.keys()]).toEqual([0,1,2,3,4,5])
    const edit = deform_selection(geometry, selection, (point, w) => point.addScaledVector(new Vector3(0,0,1), w))
    expect(edit.attributes.position.getZ(0)).toBeGreaterThan(.02)
    expect(edit.attributes.position.getZ(1)).toBe(edit.attributes.position.getZ(3))
    expect(edit.attributes.position.getZ(6)).toBe(geometry.attributes.position.getZ(6))
    expect(geometry.attributes.position.getZ(0)).toBe(0)
    const tinted = tint_selection(edit, selection, new Color(0x5599cc), 1)
    expect(tinted.attributes.color.getX(0)).toBeLessThan(1)
    expect(tinted.attributes.color.getX(6)).toBe(1)
  })

  it('removes a connecting tube strip, then closes the two ends independently', () => {
    const points: number[] = [], faces: number[] = []
    for (let ring = 0; ring < 5; ring++) points.push(0,ring,0, 1,ring,0, 1,ring,1, 0,ring,1)
    for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
      const a = r*4+i, b = r*4+(i+1)%4, c = b+4, d = a+4
      faces.push(a,b,c, a,c,d)
    }
    faces.push(0,2,1, 0,3,2, 16,17,18, 16,18,19)
    const source = geometry_of(points, faces)
    const selected = new Map(Array.from({length:12},(_, i) => [i+4,1]))
    const cut = cut_selection(source, selected, true)
    expect(cut.open).toBe(false)
    expect(cut.removed).toBe(16)
    expect(cut.geometry.attributes.position.count).toBe(16)
    const edges = new Map<string, number>()
    const index = Array.from(cut.geometry.index!.array)
    for (let i = 0; i < index.length; i+=3) {
      const group = index.slice(i,i+3)
      const y = group.map(id=>cut.geometry.attributes.position.getY(id))
      expect(y.every(y=>y<2) || y.every(y=>y>2)).toBe(true)
      for(let j=0; j<3; j++){
        const edge = [group[j],group[(j+1)%3]].sort().join(',')
        edges.set(edge,(edges.get(edge)??0)+1)
      }
    }
    expect([...edges.values()].every(uses=>uses===2)).toBe(true)
  })

  it('writes only changed geometry in a GLB while preserving an instanced sibling', async () => {
    const json = {
      asset: {version:'2.0'}, scene:0, scenes:[{nodes:[0,1]}], nodes:[{mesh:0},{mesh:0}],
      meshes:[{primitives:[{attributes:{POSITION:0}}]}],
      buffers:[{byteLength:36}], bufferViews:[{buffer:0,byteLength:36}],
      accessors:[{bufferView:0,count:3,componentType:5126,type:'VEC3',min:[0,0,0],max:[1,1,0]}]
    }
    const pos = [0,0,0,1,0,0,0,1,0], bytes = new TextEncoder().encode(JSON.stringify(json))
    const padded = (bytes.length+3)&~3
    const glb = new ArrayBuffer(28+padded+36), view = new DataView(glb), data = new Uint8Array(glb)
    ;[0x46546c67,2,glb.byteLength,padded,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true))
    data.fill(32,20,20+padded); data.set(bytes,20)
    view.setUint32(20+padded,36,true); view.setUint32(24+padded,0x004e4942,true)
    new Float32Array(glb,28+padded).set(pos)
    const source = geometry_of(pos, [0,1,2])
    const edit = deform_selection(source, new Map([[0,1]]), p=>p.add(new Vector3(0,0,1)))
    const result = write_mesh_edits(glb,[{id:'n0',original:source,geometry:edit}])
    const loaded = await new GLTFLoader().parseAsync(result,'')
    const meshes = loaded.scene.children as Mesh[]
    expect(meshes[0].geometry.attributes.position.getZ(0)).toBe(1)
    expect(meshes[1].geometry.attributes.position.getZ(0)).toBe(0)
    expect(Array.from(new Float32Array(glb,28+padded))).toEqual(pos)
    verify_original_for_fit(result, glb)
    const reference = await load_fit_surface(result)
    expect(reference?.meshes).toHaveLength(2)
    expect(reference?.meshes.map(mesh => mesh.geometry.attributes.position.getZ(0))).toEqual([0,0])
    const wrong = glb.slice(0)
    new Uint8Array(wrong)[28+padded] ^= 1
    expect(() => verify_original_for_fit(result, wrong)).toThrow('отличается')

    edit.setIndex([0,1,2,0,2,1])
    edit.addGroup(0,3,0); edit.addGroup(3,3,1)
    const colored = write_mesh_edits(glb, [{id:'n0', original:source, geometry:edit, seam_colors:new Map([[1,[.4,.2,.1]]])}])
    const changed = await new GLTFLoader().parseAsync(colored,'')
    const [body, cap] = changed.scene.children[0].children as Mesh[]
    expect(body.geometry.index?.count).toBe(3)
    expect(body.material).not.toBe(cap.material)
    expect(cap.geometry.index?.count).toBe(3)
    expect((cap.material as MeshStandardMaterial).color.toArray()).toEqual([.4,.2,.1])
    expect((await load_fit_surface(colored))?.meshes).toHaveLength(2)
  })
})
