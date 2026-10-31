import fs from 'node:fs'
import { load_without_textures } from './chest-fixtures.ts'
import { build_rig_asset } from '../src/my-rigs/RigAsset.ts'
export async function library_asset (path: string) {
 const b=fs.readFileSync(path),doc=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())
 return build_rig_asset(await load_without_textures(path),doc,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),path)
}
