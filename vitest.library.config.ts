import { defineConfig } from 'vitest/config'
import { mkdirSync } from 'node:fs'

mkdirSync('checks', { recursive: true })

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/phoenix-restoration.test.ts',
      'tests/animal-templates.test.ts',
      'tests/creature-library.test.ts',
      'tests/creature-retarget.test.ts',
      'src/test/AnimalCrossSection.test.ts',
      'src/test/CreatureRig.test.ts'
    ],
    testTimeout: 120000,
    maxWorkers: 1
  }
})
