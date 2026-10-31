// @vitest-environment node
import {expect,it} from 'vitest'
import {Group,Bone,AnimationClip,VectorKeyframeTrack} from 'three'
import {document_from_fbx_scene} from '../src/my-rigs/MotionDocument.ts'
function rig(sameID:boolean,offset=0){
 const scene=new Group(),parent=new Bone(),leaf=new Bone();parent.name=leaf.name='Hips';Object.assign(parent,{ID:123});Object.assign(leaf,{ID:sameID?123:124});leaf.position.x=offset;parent.add(leaf);scene.add(parent);scene.animations=[new AnimationClip('Jump',1,[new VectorKeyframeTrack('Hips.position',[0,1],[0,0,0,0,1,0])])];return scene
}
it('collapses only identity FBX aliases with the same source ID and leaves the scene untouched',()=>{
 const scene=rig(true),doc=document_from_fbx_scene(scene,'Shared skin');expect(doc.nodes.filter(n=>n.joint)).toHaveLength(1);expect(doc.clips[0].tracks).toHaveLength(1);expect(scene.children[0].children).toHaveLength(1)
})
it('rejects real duplicate joint names rather than guessing by hierarchy',()=>{
 expect(()=>document_from_fbx_scene(rig(false),'Different IDs')).toThrow(/неоднозначное/)
 expect(()=>document_from_fbx_scene(rig(true,1),'Different transforms')).toThrow(/неоднозначное/)
})
