import fs from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
export async function load_without_textures(path: string) {
 const b=fs.readFileSync(path),view=new DataView(b.buffer,b.byteOffset,b.byteLength),n=view.getUint32(12,true),doc=JSON.parse(b.subarray(20,20+n).toString()),bin=b.subarray(28+n)
 delete doc.images;delete doc.textures;delete doc.materials;delete doc.samplers
 for(const mesh of doc.meshes??[])for(const p of mesh.primitives)delete p.material
 const j=Buffer.from(JSON.stringify(doc)),size=Math.ceil(j.length/4)*4,out=Buffer.alloc(28+size+bin.length),v=new DataView(out.buffer,out.byteOffset,out.byteLength)
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,size,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+size);j.copy(out,20);v.setUint32(20+size,bin.length,true);v.setUint32(24+size,0x004e4942,true);bin.copy(out,28+size)
 return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength),'')
}
