/** Bundled symbols for procedural motions: there are no stock preview videos
 * for a user-fitted skeleton. Export clip identifiers stay unchanged. */
const motions: Record<string, { label: string, path: string }> = {
  Creature_Rest_Pose: { label: 'Исходная поза', path: 'M32 21v22m-15-13h30M32 43L22 57m10-14 10 14' },
  Creature_Idle: { label: 'Покой', path: 'M32 21v22m0-15-12 9m12-9 12 9M32 43l-8 14m8-14 8 14M13 23q-7 10 0 20m38-20q7 10 0 20' },
  Creature_Walk: { label: 'Ходьба', path: 'M32 21l-3 20m2-13-13 7m13-7 11 5M29 41l-9 15h-6m15-15 11 7 6-5' },
  Creature_Fly_Flap: { label: 'Взмах', path: 'M32 21v27m-4-15L13 16 7 28l19 15m10-10 15-17 6 12-19 15M8 10V3m-4 4 4-4 4 4m40 3V3m-4 4 4-4 4 4M32 48l-5 10m5-10 5 10' },
  Creature_Fly_Glide: { label: 'Планирование', path: 'M32 21v26m-4-16L5 25l8 15 15-2m8-7 23-6-8 15-15-2M32 47l-5 10m5-10 5 10' }
}

export function creature_motion_label (name: string): string | undefined {
  return motions[name]?.label
}

export function creature_motion_symbol (name: string): string {
  const motion = motions[name]
  if (!motion) return ''
  return `<svg viewBox="0 0 64 64" aria-hidden="true" class="anim-creature-symbol" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="14" r="6"/><path d="${motion.path}"/></svg><small>▶ Смотреть</small>`
}
