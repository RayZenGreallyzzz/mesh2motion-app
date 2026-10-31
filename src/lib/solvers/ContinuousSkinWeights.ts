/** Four slots cannot retain five equal influences continuously everywhere.
 * Fade the last retained influence to zero at its competition boundary instead
 * of replacing a nonzero fourth slot with a different bone across one triangle.
 */
export function continuous_skin_weights (entries: Array<[number, number]>, count = 4): Array<[number, number]> {
  const sorted = entries.filter(([, w]) => Number.isFinite(w) && w > 0).sort((a,b) => b[1]-a[1])
  const cutoff = sorted[count]?.[1] ?? 0, top = sorted.slice(0,count)
  let sum = 0
  const faded = top.map(([id,w]):[number,number] => { const value=Math.max(0,w-cutoff);sum+=value;return [id,value] })
  if (sum < 1e-12) { const total=top.reduce((s,[,w])=>s+w,0);return top.map(([id,w])=>[id,w/total]) }
  return faded.filter(([,w])=>w>0).map(([id,w])=>[id,w/sum])
}
