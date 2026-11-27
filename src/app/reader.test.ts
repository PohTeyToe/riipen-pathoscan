import { describe, expect, it } from 'vitest'
import { discRegion, type Region } from '../lib/find'
import type { RunRead, TubeRead } from '../lib/readers'
import { liquidCentre, makeRun, photograph, render, type Img, type Role } from '../lib/synth'
import { sclerotinia } from './assays/sclerotinia'
import { findRings, LABELS, radius, readTubes, removeRing, RING_STROKE_PX, ringAt, ringShape, ROLES, tapInOrder, tapRings } from './reader'
import { newRun, tally, tapsDecided, treatAtFor, type Run, type Tap } from './run'

const box = (cx: number, cy: number, half: number): Region => ({ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half, cx, cy })
const row = (n: number, half = 10) => Array.from({ length: n }, (_, i) => box(50 + i * 100, 100, half))

describe('labelling by taps in order', () => {
  const tapAll = (taps: number[]) => taps.reduce<number[]>((order, i) => tapInOrder(order, i), [])
  it('gives each tapped ring the next label: +, −, then samples 1 to 8', () => {
    expect(LABELS).toEqual(['+', '−', '1', '2', '3', '4', '5', '6', '7', '8'])
    expect(ROLES).toEqual(['pc', 'nc', 'sample', 'sample', 'sample', 'sample', 'sample', 'sample', 'sample', 'sample'])
    // Any layout: the order of the taps is the only thing that names a tube.
    expect(tapAll([7, 2, 9, 0, 1, 3, 4, 5, 6, 8])).toEqual([7, 2, 9, 0, 1, 3, 4, 5, 6, 8])
  })
  it('undoes a label and every label after it when its ring is tapped again', () => {
    expect(tapAll([4, 5, 6, 7])).toEqual([4, 5, 6, 7])
    expect(tapAll([4, 5, 6, 7, 5])).toEqual([4])
    expect(tapAll([4, 5, 6, 7, 7])).toEqual([4, 5, 6])
    expect(tapAll([4, 5, 4])).toEqual([])
    expect(tapAll([4, 5, 6, 5, 6, 5])).toEqual([4, 6, 5])
  })
  it('stops at ten labels, but a labelled ring still undoes', () => {
    const all = tapAll([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tapInOrder(all, 10)).toEqual(all)
    expect(tapInOrder(all, 9)).toHaveLength(9)
  })
})

describe('finding the ring a tap is on, while labelling', () => {
  it('takes the nearest ring', () => {
    const rings = row(3)
    expect(ringAt(rings, 160, 100, 30)).toBe(1)
    expect(ringAt(rings, 100, 100, 30)).toBe(-1)
  })
  it('picks the nearest ring centre, never a neighbour whose box happens to be closer', () => {
    // Tubes 27 px apart; the first ring's box is wide (a glare streak joined to it), the second narrow.
    const rings = [box(0, 0, 12), box(27, 0, 3), box(54, 0, 3)]
    expect(ringAt(rings, 16, 0, 40)).toBe(1)
    expect(ringAt(rings, 12, 0, 40)).toBe(0)
  })
  it('takes a tap only within half the spacing to the next ring, so a tap between two tubes hits neither', () => {
    const rings = [box(0, 0, 3), box(27, 0, 3), box(54, 0, 3)]
    expect(ringAt(rings, 13.5, 0, 40)).toBe(-1)
    expect(ringAt(rings, 40.5, 3, 40)).toBe(-1)
    expect(ringAt(rings, 13, 0, 40)).toBe(0)
    expect(ringAt(rings, 41, 0, 40)).toBe(2)
  })
  it('finds no ring at a missed tube that sat close to its neighbour', () => {
    // Tubes 30 px apart, the last two only 15 px apart (a real kit photo). The finder missed the one at 120.
    const rings = [0, 30, 60, 90, 135].map((x) => box(x, 0, 3))
    expect(ringAt(rings, 120, 0, 40)).toBe(-1)
  })
  it('counts a tap inside a big ring as on it, whatever the reach', () => {
    expect(ringAt([box(100, 100, 40)], 135, 100, 5)).toBe(0)
  })
})

describe('fixing rings by taps: a tap on a ring as painted removes it, anywhere else adds one', () => {
  /** A photo as the app saves it, 1400 px wide, on a 360 px phone: about 3.9 photo pixels to a CSS pixel. */
  const W = 1400
  const P = W / 360
  /** How far a ring's paint reaches past its ellipse: half its line. */
  const line = (RING_STROKE_PX / 2) * P
  // Small tubes in a wide shot: liquid 12 px wide, most tubes 100 px apart. Each ring is painted about 16 CSS px
  // across, far wider than its tube.
  const small = () => [box(0, 0, 6), box(100, 0, 6), box(200, 0, 6), box(400, 0, 6)]

  it('removes the ring a tap lands on', () => {
    expect(tapRings(row(3), 155, 104, W, P).map((r) => r.cx)).toEqual([50, 250])
  })
  it('removes a small ring on a tap 3.3 CSS px from its centre, off the liquid but inside the ring', () => {
    const rings = small()
    expect(tapRings(rings, 200 + 3.3 * P, 0, W, P)).toEqual(removeRing(rings, 2))
  })
  it('removes a small ring on a tap on its line, and adds a ring on a tap clearly outside the line', () => {
    const rings = small()
    const e = ringShape(rings[2], W)
    // 1 CSS px outside the ellipse, inside the 3 px line painted on it.
    expect(tapRings(rings, 229.4545, 0, W, P)).toEqual(removeRing(rings, 2))
    expect(tapRings(rings, 200, -e.ry - line + 1, W, P)).toEqual(removeRing(rings, 2))
    const outside = 200 + e.rx + line + 2 * P
    expect(tapRings(rings, outside, 0, W, P)).toEqual([...rings, discRegion(outside, 0, 6)])
  })
  it.each([360, 720, 960])('rings a separate tube the finder missed, beside a ringed one, on a %i px wide screen', (screen) => {
    // Ten tubes in two rows of five, 75 CSS px apart, liquid 33.45 CSS px wide; the second sits only 48 px from
    // the first and has no ring.
    const k = W / screen
    const at = (x: number, y: number) => box(x * k, y * k, (33.45 / 2) * k)
    const rings = [at(40, 100), ...[163, 238, 313].map((x) => at(x, 100)), ...[40, 115, 190, 265, 340].map((x) => at(x, 200))]
    // On the missed tube's liquid, near the ringed one's side.
    const out = tapRings(rings, 72.5 * k, 100 * k, W, k)
    expect(out).toHaveLength(10)
    expect(out.slice(0, 9)).toEqual(rings)
  })
  it('where two painted rings overlap, removes the one the tap is on, never one it is not on', () => {
    const rings = [box(200, 0, 6), box(232, 0, 6)]
    const [a, b] = rings
    expect(tapRings(rings, 190, 0, W, P)).toEqual([b]) // on A only
    expect(tapRings(rings, 240, 0, W, P)).toEqual([a]) // on B only
    // Inside both painted rings: each ring's claim ends halfway to the other.
    expect(tapRings(rings, 214, 0, W, P)).toEqual([b])
    expect(tapRings(rings, 217, 0, W, P)).toEqual([a])
    expect(tapRings(rings, 270, 0, W, P)).toHaveLength(3) // on neither
  })
  it("rings again a tube in a close row whose ring was removed, though its neighbours' painted rings cover it", () => {
    // Tubes 6 CSS px apart, liquid 3.6 px wide, each ring painted about 16 px across.
    const rings = Array.from({ length: 10 }, (_, i) => box(100 + 6 * P * i, 100, 1.8 * P))
    const gone = removeRing(rings, 4)
    expect(tapRings(gone, rings[4].cx, rings[4].cy, W, P)).toEqual([...gone, discRegion(rings[4].cx, rings[4].cy, 1.8 * P)])
  })
  it('rings a tube touching a ringed one with a plain tap on it, so both are ringed, each labelled by its own tap', () => {
    // One pair touches, 32 px apart: the finder ringed the first; a finger's reach (79 px) takes in the second.
    const reach = 79
    const rings = small()
    const both = tapRings(rings, 232, 0, W, P)
    expect(both).toHaveLength(5)
    expect(both.slice(0, 4)).toEqual(rings)
    expect(ringAt(both, 200, 0, reach)).toBe(2)
    expect(ringAt(both, 232, 0, reach)).toBe(4)
    // A tap on either ring removes that ring and no other.
    expect(tapRings(both, 209, 2, W, P)).toEqual(removeRing(both, 2))
    expect(tapRings(both, 233, 1, W, P)).toEqual(rings)
  })
  it('removes every ring the finder draws on a synthetic photo by a tap at its painted centre', () => {
    for (const layout of ['row', '2x5', 'tilted', 'small'] as const)
      for (const seed of [0, 1]) {
        const { img } = photograph(makeRun(seed), layout)
        const rings = findRings(img)
        expect(rings.length).toBeGreaterThan(0)
        rings.forEach((r, i) => {
          const e = ringShape(r, img.width)
          expect([layout, seed, i, tapRings(rings, e.cx, e.cy, img.width, img.width / 360)]).toEqual([layout, seed, i, removeRing(rings, i)])
        })
      }
  })
  it('takes off a ring added by a tap just beside a ring with a tap on it, leaving the ring beside it', () => {
    const rings = small()
    const stray = tapRings(rings, 200 + 40, 0, W, P)
    expect(stray).toHaveLength(5)
    const e = ringShape(stray[4], W)
    expect(tapRings(stray, e.cx, e.cy, W, P)).toEqual(rings)
  })
  it("adds a ring on empty paper inside the liquid: the median ring's narrow side", () => {
    const tall = (cx: number, w: number, h: number): Region => ({ x0: cx - w, y0: 100 - h, x1: cx + w, y1: 100 + h, cx, cy: 100 })
    const rings = [tall(50, 8, 20), tall(250, 10, 30), tall(350, 30, 40)]
    const out = tapRings(rings, 150, 100, W, P)
    expect(out.slice(0, 3)).toEqual(rings)
    expect(out[3]).toEqual(discRegion(150, 100, 10))
    expect(radius(out[3])).toBe(10)
  })
  it('puts an added ring back on the same spot when tapped again', () => {
    const rings = row(9)
    const added = tapRings(rings, 950, 100, W, P)
    expect(added).toHaveLength(10)
    expect(tapRings(added, 951, 99, W, P)).toEqual(rings)
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
  // The grower taps the tubes in label order; makeRun lays them out as +, −, then samples 1 to 8.
  const read = (photo: Img, flip: boolean) => {
    const rings = findRings(photo)
    const order = spec.tubes.reduce<number[]>((o, _, i) => tapInOrder(o, ringAt(rings, ...(at(i, flip) as [number, number]), 20)), [])
    const r = readTubes(photo, order.map((i) => rings[i]), ROLES)
    return { rings, order, calls: r.tubes.map((t) => t.call), status: r.status }
  }

  it('finds ten rings and reads against the controls tapped first', () => {
    const { rings, calls, status } = read(img, false)
    expect(rings).toHaveLength(10)
    expect(status).toBe('ok')
    expect(calls.slice(0, 2)).toEqual(['pos', 'neg'])
  })
  it('reads a ring the grower removed and added back on the liquid the same as the ring the finder drew', () => {
    for (const seed of [4, 7]) {
      const run = makeRun(seed)
      const photo = render(run, 1)
      const rings = findRings(photo)
      const centre = (i: number) => [liquidCentre(run, i).x, liquidCentre(run, i).y] as [number, number]
      const calls = (rs: typeof rings) => readTubes(photo, run.tubes.map((_, i) => rs[ringAt(rs, ...centre(i), 20)]), ROLES).tubes.map((t) => t.call)
      const found = calls(rings)
      for (let i = 2; i < 10; i++) {
        const ring = rings[ringAt(rings, ...centre(i), 20)]
        const px = photo.width / 360
        const readded = tapRings(tapRings(rings, ring.cx, ring.cy, photo.width, px), ...centre(i), photo.width, px)
        expect(readded.find((r) => r.r !== undefined)).toBeDefined()
        expect([seed, i, calls(readded)[i]]).toEqual([seed, i, found[i]])
      }
    }
  })
  it('gives every label the same call on a photo turned 180 degrees, tapped tube by tube', () => {
    const upright = read(img, false)
    const turned = read(turn(img), true)
    expect(turned.rings).toHaveLength(10)
    expect(turned.calls).toEqual(upright.calls)
    // Reading order runs the other way, so the taps land on the rings in the opposite order.
    expect(upright.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(turned.order).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  })
})

// A run of 2 controls and 8 samples with the given sample calls.
const runRead = (samples: TubeRead['call'][], status: RunRead['status'] = 'ok'): { read: RunRead; roles: Role[] } => ({
  read: { status, flags: [], tubes: [{ call: 'pos', reason: '' }, { call: 'neg', reason: '' }, ...samples.map((call) => ({ call, reason: '' }))] },
  roles: ROLES,
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

  it("reads a run under its test's rule only with as many samples as the rule is for", () => {
    expect(treatAtFor(sclerotinia, 8)).toBe(2)
    for (const samples of [1, 6, 7]) expect(treatAtFor(sclerotinia, samples)).toBeUndefined()
  })

  it('gives no advice with no rule: the count, and an end once every held tube is called', () => {
    const read: RunRead = { status: 'ok', flags: [], tubes: (['pos', 'neg', 'pos', 'held', 'neg'] as const).map((call) => ({ call, reason: '' })) }
    const roles = ROLES.slice(0, 5)
    expect(tally(read, roles, [null, null, null, null, null])).toEqual({ rule: undefined, readerPositives: 1, tappedPositives: 0, outcome: undefined })
    expect(tally(read, roles, [null, null, null, 'pos', null])).toEqual({ rule: undefined, readerPositives: 1, tappedPositives: 1, outcome: 'no-advice' })
  })

  it('fails a run the reader refused, counts nothing and keeps the taps as notes', () => {
    const { read, roles } = runRead(Array(8).fill('held'), 'failed')
    const t = tally(read, roles, taps({ 2: 'pos', 3: 'pos', 4: 'pos' }), 3)
    expect(t).toEqual({ rule: { treatAt: 3 }, readerPositives: undefined, tappedPositives: undefined, outcome: 'failed' })
    const run: Run = { ...newRun(sclerotinia, { field: 'f', notes: '' }), read, roles, taps: taps({ 2: 'pos' }), ...t }
    expect(tapsDecided(run)).toBe(false)
  })
})
