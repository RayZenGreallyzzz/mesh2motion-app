export const builtin_models = [
  ['human', 'Человек', 'Human_Male'], ['goblin', 'Гоблин', 'Goblin'], ['orc', 'Орк', 'Orc'],
  ['wolf', 'Волк', 'Wolf'], ['fox', 'Лиса', 'Fox'], ['rabbit', 'Кролик', 'Rabbit'],
  ['deer', 'Олень', 'Deer'], ['dragon', 'Дракон', 'Dragon']
].map(([id, title, file]) => ({ id, title, path: 'models/phoenix/' + file + '_Android.glb' }))
