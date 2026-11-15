import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { mount_catalog } from '../src/library/Catalog.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'
import { read_glb } from '../src/test/GlbFixture.ts'
import { build_rig_asset } from '../src/my-rigs/RigAsset.ts'
import { suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'

it('opens and transfers the built-in motion banks from the Studio library', async () => {
  const host = document.createElement('section')
  const open = vi.fn()
  const take = vi.fn()
  mount_catalog(host, open, take)
  for (const [name, suffix] of [
    ['Человек — основные движения', 'human-base'],
    ['Человек — дополнительные движения', 'human-addon'],
    ['Человек — захват движений', 'human-mocap'],
    ['Лиса', 'fox'], ['Птица', 'bird'], ['Дракон', 'dragon'], ['Кайдзю', 'kaiju'],
    ['Паук', 'spider'], ['Змея', 'snake'], ['Акула', 'shark'], ['Лошадь', 'horse']
  ]) {
    const cards = [...host.querySelectorAll('article')].filter(card =>
      card.querySelector('h3')?.textContent?.startsWith(name) && card.querySelector('p')?.textContent === 'Mesh2Motion')
    expect(cards).toHaveLength(1)
    const path = 'animations/' + suffix + '-animations.glb'
    cards[0].querySelector('button')!.click()
    cards[0].querySelector<HTMLButtonElement>('button[data-motion]')!.click()
    expect(open).toHaveBeenLastCalledWith(path, expect.any(String))
    expect(take).toHaveBeenLastCalledWith(path, expect.any(String))
    const source = 'static/' + path
    const bytes = Uint8Array.from(readFileSync(source)).buffer
    const asset = build_rig_asset(await read_glb(source), inspect_glb(bytes), bytes, name)
    expect(asset.clips.length).toBeGreaterThan(0)
    expect(transfer_clips(asset, asset, suggest_mapping(asset, asset), [0])).toHaveLength(1)
  }
  expect(host.querySelectorAll('button[data-motion]').length).toBeGreaterThan(11)
})
