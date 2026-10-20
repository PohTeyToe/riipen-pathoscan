import { describe, expect, it } from 'vitest'
import { emptyConfusion, fitCut, fitLogistic, readSynthetic, score } from './evaluate'
import { discRegion, findRegions, measure, readingOrder, type Features } from './find'
import { readByGroup, readCalibrated, readMidpoint, readNaive, QC } from './readers'
import { relight } from './relight'
import { makeRun, render, type Img, type Role } from './synth'

const model = { w0: -3.7, w1: 7.8 }
const band = { lo: 0.2, hi: 0.8 }

/** A measured tube with a given Lab hue and enough colour and pixels to read. */
const tube = (labHue: number, rawHue = labHue / 2, clear = 400): Features => {
  const a = 40 * Math.cos((labHue * Math.PI) / 180)
  const b = 40 * Math.sin((labHue * Math.PI) / 180)
  return { raw: [200, 150, 100], rawHue, corrected: [1, 0.7, 0.4], lab: { L: 70, a, b }, labHue, clear, glare: 0, paperFrom: 'local' }
}
const roles = (n: number): Role[] => ['pc', 'nc', ...Array<Role>(n).fill('sample')]

describe('calibrated reader', () => {
  it('calls against the run controls and holds what sits between them', () => {
    const r = readCalibrated([tube(90), tube(10), tube(95), tube(12), tube(50)], roles(3), model, band)
    expect(r.tubes.slice(2).map((t) => t.call)).toEqual(['pos', 'neg', 'held'])
    expect(r.flags).toEqual([])
  })
  it('reads the same run the same way when every hue shifts together', () => {
    const shift = (d: number) => readCalibrated([tube(90 + d), tube(10 + d), tube(80 + d), tube(25 + d)], roles(2), model, band).tubes.map((t) => t.call)
    expect(shift(-15)).toEqual(shift(0))
    expect(shift(20)).toEqual(shift(0))
  })
  it('holds the whole run when the controls are too close', () => {
    const r = readCalibrated([tube(30), tube(20), tube(90)], roles(1), model, band)
    expect(r.tubes[2].call).toBe('held')
    expect(r.flags[0]).toMatch(/too close/)
  })
  it('holds the run when the positive control is pinker than the negative', () => {
    expect(readCalibrated([tube(10), tube(90), tube(50)], roles(1), model, band).flags[0]).toMatch(/pinker/)
  })
  it('flags a positive control weaker than samples', () => {
    const r = readCalibrated([tube(60), tube(10), tube(85), tube(88)], roles(2), model, band)
    expect(r.flags.some((f) => /weaker than 2 samples/.test(f))).toBe(true)
  })
  it('reads against the positive control that turned and flags the one that did not', () => {
    const r = readCalibrated([tube(90), tube(15), tube(10), tube(85)], ['pc', 'pc', 'nc', 'sample'], model, band)
    expect(r.scale?.pc).toBe(90)
    expect(r.flags.some((f) => /barely changed/.test(f))).toBe(true)
    expect(r.tubes[3].call).toBe('pos')
  })
  it('holds the run when negative controls disagree instead of averaging them', () => {
    const r = readCalibrated([tube(90), tube(10), tube(90), tube(50)], ['pc', 'nc', 'nc', 'sample'], model, band)
    expect(r.tubes[3].call).toBe('held')
    expect(r.flags[0]).toMatch(/negative controls disagree/)
  })
  it('averages negative controls that agree', () => {
    const r = readCalibrated([tube(90), tube(10), tube(14), tube(88)], ['pc', 'nc', 'nc', 'sample'], model, band)
    expect(r.scale?.nc).toBe(12)
    expect(r.tubes[3].call).toBe('pos')
  })
  it('holds tubes with too few clear pixels and says why', () => {
    const r = readCalibrated([tube(90), tube(10), tube(95, 45, QC.minClear - 1)], roles(1), model, band)
    expect(r.tubes[2]).toMatchObject({ call: 'held', reason: expect.stringMatching(/clear pixels/) })
  })
  it('needs both controls', () => {
    const r = readCalibrated([tube(90), tube(80)], ['sample', 'sample'], model, band)
    expect(r.tubes.every((t) => t.call === 'held')).toBe(true)
  })
  it('reads each group against its own controls', () => {
    const feats = [tube(90), tube(10), tube(85), tube(55), tube(40), tube(58)]
    const rl: Role[] = ['pc', 'nc', 'sample', 'pc', 'nc', 'sample']
    const r = readByGroup(['A', 'A', 'A', 'B', 'B', 'B'], (idx) => readCalibrated(idx.map((i) => feats[i]), idx.map((i) => rl[i]), model, band))
    expect(r.tubes[2].call).toBe('pos')
    expect(r.flags.some((f) => f.startsWith('B: '))).toBe(true)
  })
})

describe('naive and midpoint rules', () => {
  it('naive calls on the raw hue alone and never holds', () => {
    const r = readNaive([tube(0, 30), tube(0, 10), null], 23.5)
    expect(r.tubes.map((t) => t.call)).toEqual(['pos', 'neg', 'neg'])
  })
  it('midpoint uses halfway between the controls raw hues', () => {
    const r = readMidpoint([tube(0, 26), tube(0, -4), tube(0, 11.5), tube(0, 6)], roles(2))
    expect(r.tubes.slice(2).map((t) => t.call)).toEqual(['pos', 'neg'])
  })
})

describe('finding and measuring', () => {
  it('finds the ten tubes of a synthetic run in left-to-right order', () => {
    const img = render(makeRun(608, 'typical', { kelvin: 5500, ev: 0, drift: 0 }), 0.5)
    const { regions } = findRegions(img)
    expect(regions).toHaveLength(10)
    const xs = regions.map((r) => r.cx)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })
  it('keeps a slanted line of tubes as one row and splits plate rows', () => {
    const box = (cx: number, cy: number) => ({ x0: cx - 4, x1: cx + 4, y0: cy - 4, y1: cy + 4, cx, cy })
    const slant = [0, 1, 2, 3, 4].map((i) => box(100 - i * 20, 50 + i * 3))
    expect(readingOrder(slant).map((r) => r.cx)).toEqual([20, 40, 60, 80, 100])
    const plate = [box(30, 20), box(10, 21), box(10, 40), box(30, 41)]
    expect(readingOrder(plate).map((r) => [r.cx, r.cy])).toEqual([[10, 21], [30, 20], [10, 40], [30, 41]])
    const tiltedRows = [box(10, 20), box(30, 23), box(10, 30), box(30, 33)].map((b) => ({ ...b, y0: b.cy - 4.5, y1: b.cy + 4.5 }))
    expect(readingOrder(tiltedRows).map((r) => [r.cx, r.cy])).toEqual([[10, 20], [30, 23], [10, 30], [30, 33]])
  })
  it('matches every tube in clean runs', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(readSynthetic(makeRun(seed, 'typical', { ev: 0 }), 0.5).missed).toBe(0)
  })
  it('skips washed-out pixels inside a disc and counts them as glare', () => {
    const w = 40
    const data = new Uint8ClampedArray(w * w * 4)
    for (let i = 0; i < w * w; i++) {
      const x = i % w
      const inner = Math.hypot(x - 20, Math.floor(i / w) - 20) < 4
      data.set(inner ? [255, 255, 255, 255] : [230, 200, 60, 255], i * 4)
    }
    const img: Img = { width: w, height: w, data }
    const f = measure(img, discRegion(20, 20, 10), [0.9, 0.9, 0.9])!
    expect(f.glare).toBeGreaterThan(0)
    expect(f.raw).toEqual([230, 200, 60])
    expect(measure(img, discRegion(20, 20, 10, 5), [0.9, 0.9, 0.9])!.glare).toBe(0)
  })
  it('relighting at neutral light and 0 stops changes nothing', () => {
    const img = render(makeRun(1), 0.2)
    expect(relight(img, 5500, 0)).toBe(img)
  })
})

describe('scoring and fitting', () => {
  it('counts wrong and held calls separately', () => {
    const c = emptyConfusion()
    c.pos.pos = 8
    c.pos.held = 1
    c.pos.neg = 1
    c.neg.neg = 9
    c.neg.pos = 1
    const s = score(c)
    expect(s).toMatchObject({ wrong: 2, held: 1, samples: 20, sensitivity: 0.8, specificity: 0.9 })
    expect(s.accuracyCalled).toBeCloseTo(17 / 19)
  })
  it('recovers a known logistic model', () => {
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < 4000; i++) {
      const x = (i % 200) / 100 - 0.5
      xs.push(x)
      ys.push((i * 0.618) % 1 < 1 / (1 + Math.exp(-(-4 + 8 * x))) ? 1 : 0)
    }
    const m = fitLogistic(xs, ys)
    expect(m.w0).toBeCloseTo(-4, 0)
    expect(m.w1).toBeCloseTo(8, 0)
  })
  it('picks the cut that separates two clean groups', () => {
    expect(fitCut([1, 2, 3, 30, 31], [0, 0, 0, 1, 1])).toBeGreaterThan(3)
    expect(fitCut([1, 2, 3, 30, 31], [0, 0, 0, 1, 1])).toBeLessThanOrEqual(30)
  })
})
