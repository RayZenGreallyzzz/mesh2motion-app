import fs from 'node:fs'

const path = 'src/Mesh2MotionEngine.ts'
let source = fs.readFileSync(path, 'utf8')

const oldBlock = `  public remove_skinned_meshes_from_scene (): void {
    const existing_skinned_meshes = this.scene.children.filter((child: THREE.Object3D) => child.name.includes('Skinned Mesh'))
    existing_skinned_meshes.forEach((existing_skinned_mesh: THREE.Object3D) => {
      Utility.remove_object_with_children(existing_skinned_mesh)
    })
  }
`

const newBlock = `  public remove_skinned_meshes_from_scene (): void {
    const existing_skinned_meshes = this.scene.children.filter((child: THREE.Object3D) => child.name.includes('Skinned Mesh'))

    // SkinnedMesh instances created by StepWeightSkin intentionally reuse the
    // geometry/material objects owned by StepLoadModel. Disposing a temporary
    // skinned result here also disposes those shared GPU resources, so the next
    // weight recalculation/rebind may render with missing textures, hitch while
    // re-uploading buffers, or otherwise behave inconsistently on Android.
    //
    // This method only removes transient skinned wrappers from the scene. The
    // source model remains the owner of geometry/material resources and handles
    // their lifetime when a model is actually replaced.
    existing_skinned_meshes.forEach((existing_skinned_mesh: THREE.Object3D) => {
      existing_skinned_mesh.removeFromParent()
    })
  }
`

if (source.includes('SkinnedMesh instances created by StepWeightSkin intentionally reuse')) {
  console.log('Shared skinned resource fix already applied')
  process.exit(0)
}

if (!source.includes(oldBlock)) {
  throw new Error('Could not find remove_skinned_meshes_from_scene block to patch')
}

source = source.replace(oldBlock, newBlock)
fs.writeFileSync(path, source)
console.log('Applied shared skinned resource lifetime fix')
