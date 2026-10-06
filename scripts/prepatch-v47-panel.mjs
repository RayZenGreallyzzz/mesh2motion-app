import fs from 'node:fs'

const path = 'src/create.html'
let html = fs.readFileSync(path, 'utf8')
const current = '<small id="manual-weight-status">Зафиксируйте риг, включите кисть и проведите пальцем по модели.</small>'
const normalized = '<small id="manual-weight-status">Включите кисть, выберите кость и проведите пальцем по модели.</small>'

if (html.includes(current)) {
  html = html.replace(current, normalized)
  fs.writeFileSync(path, html)
  console.log('Normalized v4.7 manual weight status marker')
} else if (html.includes(normalized) || html.includes('id="clothing-weight-guard"')) {
  console.log('v4.7 panel marker already normalized')
} else {
  throw new Error('manual-weight-status marker not found')
}
