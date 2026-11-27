import { describe, expect, it } from 'vitest'
import { ringsNote } from './Photo'

describe('the line under the ring count', () => {
  it('says why the button is off and what to do, in plain words', () => {
    for (const n of [11, 15]) expect(ringsNote(n)).toBe('Too many rings. Tap the extra ones to remove them.')
    for (const n of [0, 1, 2]) expect(ringsNote(n)).toBe('Too few rings. Tap each tube that has no ring.')
  })
  it('says how to fix rings while the count can be read', () => {
    for (const n of [3, 8, 10]) expect(ringsNote(n)).toBe('Tap a tube to ring it. Tap a ring to remove it.')
  })
})
