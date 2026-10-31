/** Four normalized influences, shared by the preview and exported skin. */
export interface VertexWeights { indices: number[], weights: number[] }
export interface WeightEdit { mesh: number, vertex: number, base: VertexWeights, next: VertexWeights }
interface Entry { base: VertexWeights, value: VertexWeights | null }
interface Change { mesh: number, vertex: number, before: VertexWeights | null, after: VertexWeights | null }
export type ChangedVertices = Map<number, number[]>
export const selectedWeight = (v: VertexWeights, bone: number): number => v.weights.reduce((s,w,k)=>s+(v.indices[k]===bone?w:0),0)

/** Set the selected influence exactly, redistributing the remainder. Never
 * normalize the requested weight back down (the old brush stopped at 50%). */
export function setSelectedWeight(input: VertexWeights, bone: number, target: number, fallback: number): VertexWeights {
  target = Math.max(0, Math.min(1, target))
  const others = new Map<number, number>()
  input.indices.forEach((id,k)=>{ const w=input.weights[k]; if(id!==bone && Number.isFinite(w) && w>0)others.set(id,(others.get(id)??0)+w) })
  const sorted=[...others].sort((a,b)=>b[1]-a[1]).slice(0,target>0?3:4)
  // Removing the last influence transfers it to a parent, never to an arbitrary
  // root. A one-bone rig cannot shed its only influence and remains normalized.
  if(!sorted.length && target<1){ if(fallback===bone)target=1;else sorted.push([fallback,1]) }
  const sum=sorted.reduce((s,[,w])=>s+w,0)||1
  const entries:[number,number][] = target>0 ? [[bone,target]] : []
  entries.push(...sorted.map(([id,w]):[number,number]=>[id,w/sum*(1-target)]))
  entries.sort((a,b)=>b[1]-a[1])
  return {indices:Array.from({length:4},(_,k)=>entries[k]?.[0]??bone),weights:Array.from({length:4},(_,k)=>entries[k]?.[1]??0)}
}
const equal=(a:VertexWeights,b:VertexWeights)=>a.indices.every((v,k)=>v===b.indices[k])&&a.weights.every((v,k)=>Math.abs(v-b.weights[k])<1e-7)

/** Sparse absolute edits. Recalculation updates the automatic baseline while
 * keeping the user's final normalized weights. One history item is one stroke. */
export class ManualWeightEdits {
  readonly entries = new Map<number, Map<number, Entry>>()
  private undoStack: Change[][]=[]
  private redoStack: Change[][]=[]
  get canUndo(){return this.undoStack.length>0}
  get canRedo(){return this.redoStack.length>0}
  clear(){this.entries.clear();this.undoStack=[];this.redoStack=[]}
  commit(edits:WeightEdit[]):ChangedVertices {
    const changes:Change[]=[]
    for(const edit of edits){
      let mesh=this.entries.get(edit.mesh);if(!mesh){mesh=new Map();this.entries.set(edit.mesh,mesh)}
      let entry=mesh.get(edit.vertex)
      const before=entry?.value??null, current=before??edit.base
      if(equal(current,edit.next))continue
      if(!entry){entry={base:edit.base,value:null};mesh.set(edit.vertex,entry)}
      entry.value=edit.next;changes.push({mesh:edit.mesh,vertex:edit.vertex,before,after:edit.next})
    }
    return this.record(changes)
  }
  reset():ChangedVertices {
    const changes:Change[]=[]
    for(const [mesh,entries] of this.entries)for(const [vertex,entry] of entries)if(entry.value){changes.push({mesh,vertex,before:entry.value,after:null});entry.value=null}
    return this.record(changes)
  }
  private record(changes:Change[]):ChangedVertices {
    if(changes.length){this.undoStack.push(changes);this.redoStack=[];let count=this.undoStack.reduce((n,s)=>n+s.length,0);while(this.undoStack.length>1&&(this.undoStack.length>30||count>100000))count-=this.undoStack.shift()!.length}
    return this.changed(changes)
  }
  private changed(changes:Change[]):ChangedVertices {const result:ChangedVertices=new Map();for(const c of changes){let a=result.get(c.mesh);if(!a){a=[];result.set(c.mesh,a)}a.push(c.vertex)}return result}
  undo():ChangedVertices {const s=this.undoStack.pop();if(!s)return new Map();for(const c of s)this.entries.get(c.mesh)!.get(c.vertex)!.value=c.before;this.redoStack.push(s);return this.changed(s)}
  redo():ChangedVertices {const s=this.redoStack.pop();if(!s)return new Map();for(const c of s)this.entries.get(c.mesh)!.get(c.vertex)!.value=c.after;this.undoStack.push(s);return this.changed(s)}
  current(mesh:number,vertex:number):VertexWeights|undefined {const e=this.entries.get(mesh)?.get(vertex);return e?(e.value??e.base):undefined}
  apply(mesh:number,indices:number[],weights:number[]):void {
    for(const [vertex,entry] of this.entries.get(mesh)??[]){const o=vertex*4;if(o+3>=indices.length)continue;entry.base={indices:indices.slice(o,o+4),weights:weights.slice(o,o+4)};if(entry.value)for(let k=0;k<4;k++){indices[o+k]=entry.value.indices[k];weights[o+k]=entry.value.weights[k]}}
  }
}
