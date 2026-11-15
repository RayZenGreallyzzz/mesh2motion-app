import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { mount_catalog } from '../src/library/Catalog.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'
import { read_glb } from '../src/test/GlbFixture.ts'
import { build_rig_asset } from '../src/my-rigs/RigAsset.ts'
import { load_builtin_motion_source } from '../src/my-rigs/RigAssetLoader.ts'
import { inspect_transfer, suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'

it('offers only transfer for built-in motion banks and keeps their direct animation tracks', async () => {
  const host = document.createElement('section')
  const take = vi.fn()
  mount_catalog(host, take)
  expect(host.querySelector('a, button:not([data-motion])')).toBeNull()
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
    cards[0].querySelector<HTMLButtonElement>('button[data-motion]')!.click()
    expect(take).toHaveBeenLastCalledWith(path, expect.any(String))
    const source = 'static/' + path
    const bytes = Uint8Array.from(readFileSync(source)).buffer
    const target = build_rig_asset(await read_glb(source), inspect_glb(bytes), bytes, name)
    const donor = await load_builtin_motion_source(bytes, name)
    expect(donor.scene.getObjectsByProperty('isMesh', true)).toHaveLength(0)
    expect(donor.clips.map(clip => clip.name)).toEqual(target.clips.map(clip => clip.name))
    const mapping = suggest_mapping(donor, target)
    expect(inspect_transfer(donor, target, mapping, [0]).exact, path).toBe(true)
    const [clip] = transfer_clips(donor, target, mapping, [0])
    const track_data = (tracks: typeof clip.tracks) => tracks.map(track => [track.name, track.times, track.values])
    expect(track_data(clip.tracks)).toEqual(track_data(target.clips[0].tracks))
  }
  expect(host.querySelectorAll('button[data-motion]').length).toBeGreaterThan(11)
})
