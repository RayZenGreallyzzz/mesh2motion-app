import fs from 'node:fs'

const path = 'src/create.html'
let html = fs.readFileSync(path, 'utf8')

html = html.replace(
  '<strong>Веса</strong>\n            <small>Модель уже привязана к скелету. Выберите кость и поправьте влияние кистью, затем переходите к анимациям.</small>',
  '<strong>Rig Engine v2 · Surface Skin</strong>\n            <small>Автовеса идут по связной поверхности меша и сегментам костей. Для первого теста не включайте ручную кисть.</small>'
)

html = html.replace(
  '<input type="checkbox" id="clothing-weight-guard" checked />',
  '<input type="checkbox" id="clothing-weight-guard" />'
)

html = html.replace(
  'Убирает случайные веса с отдельных плащей, юбок и аксессуаров. Ручная кисть имеет приоритет.',
  'Legacy guard. Для Surface Skin v2 оставьте выключенным; включайте только для сравнения.'
)

fs.writeFileSync(path, html)
console.log('Applied v5.0 Surface Skin UI defaults')
