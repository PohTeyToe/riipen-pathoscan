import { describe, expect, it } from 'vitest'
import { discRegion, type Region } from '../lib/find'
import type { RunRead, TubeRead } from '../lib/readers'
import { liquidCentre, makeRun, render, type Img, type Role } from '../lib/synth'
import { sclerotinia } from './assays/sclerotinia'
import { findRings, radius, readTubes, ringAt, rolesFrom, tapRings, tubeNames } from './reader'
import { newRun, tally, tapsDecided, type Run, type Tap } from './run'

const box = (cx: number, cy: number, half: number): Region => ({ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half, cx, cy })
const row = (n: number, half = 10) => Array.from({ length: n }, (_, i) => box(50 + i * 100, 100, half))

describe('control taps', () => {
  it('make the tapped rings the controls and the other eight samples 1 to 8 in reading order', () => {
    const roles = rolesFrom(10, 9, 4)
    expect(roles[9]).toBe('pc')
    expect(roles[4]).toBe('nc')
    expect(roles.filter((r) => r === 'sample')).toHaveLength(8)
    expect(tubeNames(roles)).toEqual(['1', '2', '3', '4', '−', '5', '6', '7', '8', '+'])
  })
  it('refuse the same ring twice or a ring that is not there', () => {
    expect(() => rolesFrom(10, 3, 3)).toThrow()
    expect(() => rolesFrom(10, 0, 10)).toThrow()
  })
})

describe('fixing rings', () => {
  it('removes the ring a tap lands on, nearest first', () => {
    const rings = row(3)
    expect(ringAt(rings, 160, 100, 30)).toBe(1)
    expect(ringAt(rings, 100, 100, 30)).toBe(-1)
    expect(tapRings(rings, 155, 104, 30).map((r) => r.cx)).toEqual([50, 250])
  })
  it('counts a tap inside a big ring as on it, whatever the reach', () => {
    expect(ringAt([box(100, 100, 40)], 135, 100, 5)).toBe(0)
  })
  it('adds a ring sized like the median ring on empty paper, in reading order', () => {
    const rings = [box(50, 100, 8), box(250, 100, 10), box(350, 100, 30)]
    const out = tapRings(rings, 150, 100, 20)
    expect(out.map((r) => r.cx)).toEqual([50, 150, 250, 350])
    expect(out[1]).toEqual(discRegion(150, 100, 10))
    expect(radius(out[1])).toBe(10)
  })
  it('puts an added ring back on the same spot when tapped again', () => {
    const rings = row(9)
    const added = tapRings(rings, 950, 100, 20)
    expect(added).toHaveLength(10)
    expect(tapRings(added, 951, 99, 20)).toEqual(rings)
  })
})

/** A synthetic photo turned half a turn, as if taken from the other side of the tray. */
const turn = (img: Img): Img => {
  const px = new Uint32Array(img.data.slice().buffer).reverse()
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(px.buffer) }
}

describe('the photo path on a synthetic run', () => {
  const spec = makeRun(7)
  const img = render(spec, 0.6)
  const at = (i: number, flip: boolean) => {
    const { x, y } = liquidCentre(spec, i)
    return flip ? [img.width - 1 - x * 0.6, img.height - 1 - y * 0.6] : [x * 0.6, y * 0.6]
  }
  const read = (photo: Img, flip: boolean) => {
    const rings = findRings(photo)
    const tube = (i: number) => ringAt(rings, ...(at(i, flip) as [number, number]), 20)
    const r = readTubes(photo, rings, rolesFrom(rings.length, tube(0), tube(1)))
    return { rings, calls: spec.tubes.map((_, i) => r.tubes[tube(i)].call), status: r.status }
  }

  it('finds ten rings and reads against the tapped controls', () => {
    const { rings, calls, status } = read(img, false)
    expect(rings).toHaveLength(10)
    expect(status).toBe('ok')
    expect(calls.slice(0, 2)).toEqual(['pos', 'neg'])
  })
  it('gives every tube the same call on a photo turned 180 degrees once the controls are tapped', () => {
    const upright = read(img, false)
    const turned = read(turn(img), true)
    expect(turned.rings).toHaveLength(10)
    expect(turned.calls).toEqual(upright.calls)
    // Reading order runs the other way: the positive control is now the last ring, where sample 8 was.
    expect(ringAt(turned.rings, ...(at(0, true) as [number, number]), 20)).toBe(9)
  })
})

// A run of 2 controls and 8 samples with the given sample calls.
const runRead = (samples: TubeRead['call'][], status: RunRead['status'] = 'ok'): { read: RunRead; roles: Role[] } => ({
  read: { status, flags: [], tubes: [{ call: 'pos', reason: '' }, { call: 'neg', reason: '' }, ...samples.map((call) => ({ call, reason: '' }))] },
  roles: rolesFrom(10, 0, 1),
})
const taps = (t: Record<number, Tap>): Tap[] => Array.from({ length: 10 }, (_, i) => t[i] ?? null)

describe('the outcome', () => {
  it('counts the reader positives against each treatAt', () => {
    const { read, roles } = runRead(['pos', 'pos', 'neg', 'neg', 'neg', 'neg', 'neg', 'neg'])
    for (let treatAt = 1; treatAt <= 8; treatAt++)
      expect(tally(read, roles, taps({}), treatAt)).toEqual({ rule: { treatAt }, readerPositives: 2, tappedPositives: 0, outcome: treatAt <= 2 ? 'treat' : 'dont-treat' })
  })

  it('waits for the grower only while held tubes could move the run across treatAt', () => {
    const { read, roles } = runRead(['pos', 'pos', 'held', 'held', 'neg', 'neg', 'neg', 'neg'])
    const at = (treatAt: number, t: Record<number, Tap> = {}) => tally(read, roles, taps(t), treatAt).outcome
    expect(at(2)).toBe('treat') // already 2
    expect(at(5)).toBe('dont-treat') // 4 at most
    expect(at(3)).toBeUndefined()
    expect(at(4)).toBeUndefined()
    expect(at(3, { 4: 'pos' })).toBe('treat')
    expect(at(3, { 4: 'neg' })).toBeUndefined() // tube 5 still open
    expect(at(3, { 4: 'neg', 5: 'neg' })).toBe('dont-treat')
    expect(at(4, { 4: 'pos' })).toBeUndefined()
    expect(at(4, { 4: 'pos', 5: 'pos' })).toBe('treat')
  })

  it('counts a tap only on a tube the reader held', () => {
    const { read, roles } = runRead(['pos', 'neg', 'held', 'neg', 'neg', 'neg', 'neg', 'neg'])
    const t = tally(read, roles, taps({ 3: 'pos', 2: 'pos', 0: 'neg' }), 3)
    expect(t).toMatchObject({ readerPositives: 1, tappedPositives: 0, outcome: 'dont-treat' })
  })

  it('says when the taps decided the side of treatAt, for each treatAt', () => {
    const { read, roles } = runRead(['pos', 'held', 'held', 'neg', 'neg', 'neg', 'neg', 'neg'])
    const decided = (treatAt: number, t: Record<number, Tap>) => {
      const run: Run = { ...newRun(sclerotinia, { field: 'f', notes: '' }), read, roles, taps: taps(t), ...tally(read, roles, taps(t), treatAt) }
      return tapsDecided(run)
    }
    expect(decided(1, { 3: 'pos', 4: 'pos' })).toBe(false) // the reader's one positive was enough
    expect(decided(2, { 3: 'pos' })).toBe(true)
    expect(decided(2, { 3: 'neg', 4: 'neg' })).toBe(true)
    expect(decided(3, { 3: 'pos', 4: 'pos' })).toBe(true)
    expect(decided(3, { 3: 'pos' })).toBe(false) // no outcome yet
    expect(decided(4, {})).toBe(false) // 3 at most: the reader alone already says don't treat
  })

  it('fails a run the reader refused, counts nothing and keeps the taps as notes', () => {
    const { read, roles } = runRead(Array(8).fill('held'), 'failed')
    const t = tally(read, roles, taps({ 2: 'pos', 3: 'pos', 4: 'pos' }), 3)
    expect(t).toEqual({ rule: { treatAt: 3 }, readerPositives: undefined, tappedPositives: undefined, outcome: 'failed' })
    const run: Run = { ...newRun(sclerotinia, { field: 'f', notes: '' }), read, roles, taps: taps({ 2: 'pos' }), ...t }
    expect(tapsDecided(run)).toBe(false)
  })
})
