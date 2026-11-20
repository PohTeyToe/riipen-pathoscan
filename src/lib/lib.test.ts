import { describe, expect, it } from 'vitest'
import { LIN8, labHue, lightCast, linToLab, toSrgb, type RGB } from './color'
import { emptyConfusion, fitCut, fitLogistic, readSynthetic, score } from './evaluate'
import { discRegion, findRegions, measure, readingOrder, type Features } from './find'
import { readByGroup, readCalibrated, readMidpoint, readNaive, QC } from './readers'
import { makeRun, render, type Img, type Role } from './synth'

const model = { w0: -3.7, w1: 7.8 }
const band = { lo: 0.2, hi: 0.8 }

/** A measured tube with a given Lab hue, known to within `spread` degrees, and enough colour and pixels to read. */
const tube = (labHue: number, rawHue = labHue / 2, clear = 400, spread = 0): Features => {
  const a = 40 * Math.cos((labHue * Math.PI) / 180)
  const b = 40 * Math.sin((labHue * Math.PI) / 180)
  return { raw: [200, 150, 100], rawHue, corrected: [1, 0.7, 0.4], lab: { L: 70, a, b }, labHue, hueRange: [labHue - spread, labHue + spread], clipped: false, clear, glare: 0, paperBeside: true }
}
const roles = (n: number): Role[] => ['pc', 'nc', ...Array<Role>(n).fill('sample')]
const norm = (g: RGB): RGB => g.map((v) => v / Math.max(...g)) as RGB
const sheet = (w: number, h: number): Img => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) })
const paint = (img: Img, x0: number, y0: number, x1: number, y1: number, c: readonly number[]) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}

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
  it('holds a sample whose region is far bigger than the other tubes', () => {
    // A region that spread into paper lit by a lamp: its colour is the paper's, not the liquid's.
    const found = (f: Features, area: number): Features => ({ ...f, area })
    const r = readCalibrated([found(tube(90), 900), found(tube(10), 500), found(tube(10), 400), found(tube(12), 3000), found(tube(90), 1100)], roles(3), model, band)
    expect(r.tubes.slice(2).map((t) => t.call)).toEqual(['neg', 'held', 'pos'])
    expect(r.tubes[3].reason).toMatch(/bigger than the other tubes/)
    // Placed discs are sized by the reader, so their pixel counts never make a tube oversized.
    expect(readCalibrated([tube(90), tube(10), tube(10), tube(12, 6, 1300)], roles(2), model, band).tubes[3].call).toBe('neg')
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
  it('calls a tube only if every hue the white allows, its own and the controls, gives that call', () => {
    const read = (sample: number, nc: number) => readCalibrated([tube(90), tube(10, 5, 400, nc), tube(70, 35, 400, sample)], roles(1), model, band)
    expect(read(0, 0).tubes[2].call).toBe('pos')
    expect(read(5, 0).tubes[2].call).toBe('pos') // p stays past 0.8 across its range
    for (const r of [read(10, 0), read(0, 25)]) {
      expect(r.tubes[2]).toMatchObject({ call: 'held', reason: expect.stringMatching(/can't pin its colour down closer than/) })
      expect(r.tubes[2].pRange![0]).toBeLessThan(0.8)
      expect(r.flags).toEqual(["1 tube was held only because this photo can't pin down its colour. Retake it in even light, not too bright, with paper in view around each tube, to read it."])
    }
  })
  it('holds a tube the camera clipped, and fails the run for a clipped control, asking for a retake', () => {
    const clipped = (f: Features): Features => ({ ...f, clipped: true })
    const r = readCalibrated([tube(90), tube(10), clipped(tube(70)), tube(70)], roles(2), model, band)
    expect(r.tubes[2]).toEqual({ call: 'held', reason: 'Too bright here. Retake with less light.' })
    expect(r.tubes[3].call).toBe('pos')
    for (const [k, which] of [[0, 'positive'], [1, 'negative']] as const) {
      const feats = [tube(90), tube(10), tube(70)]
      feats[k] = clipped(feats[k])
      const failed = readCalibrated(feats, roles(1), model, band)
      expect(failed.status).toBe('failed')
      expect(failed.flags).toEqual([`Too bright at the ${which} control. Retake with less light.`])
      expect(failed.tubes[2]).toMatchObject({ call: 'held', reason: failed.flags[0] })
    }
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
  it('marks a run failed exactly where it refuses to read it, so callers need not match flag text', () => {
    const status = (hues: number[], rl: Role[]) => readCalibrated(hues.map((h) => tube(h)), rl, model, band).status
    expect(status([30, 20, 90], roles(1))).toBe('failed') // controls too close
    expect(status([10, 90, 50], roles(1))).toBe('failed') // positive control pinker
    expect(status([90, 10, 90, 50], ['pc', 'nc', 'nc', 'sample'])).toBe('failed') // negative controls disagree
    expect(status([90, 80], ['sample', 'sample'])).toBe('failed') // no controls
    expect(status([90, 10, 95, 12, 50], roles(3))).toBe('ok')
    expect(status([60, 10, 85, 88], roles(2))).toBe('ok') // flagged (weak control) but still read
    const feats = [tube(90), tube(10), tube(85), tube(30), tube(20), tube(58)]
    const group = (g: string[]) => readByGroup(g, (idx) => readCalibrated(idx.map((i) => feats[i]), idx.map((i) => roles(1)[i % 3]), model, band)).status
    expect(group(['A', 'A', 'A', 'B', 'B', 'B'])).toBe('failed') // group B's controls are too close
    expect(readMidpoint([tube(0, 30), tube(0, 10)], ['sample', 'sample']).status).toBe('failed')
    expect(readNaive([tube(0, 30)], 23.5).status).toBe('ok')
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
    // Short liquid blobs on a gently curved line, as in real phone photos: one row, left to right.
    const curved = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => box(100 + i * 100, 360 + 25 * ((i * 100 - 350) / 350) ** 2))
    expect(readingOrder([...curved].reverse()).map((r) => r.cx)).toEqual(curved.map((r) => r.cx))
    // Staggered rows zigzag left to right too, but each step jumps a whole row: two rows.
    const staggered = [box(10, 20), box(110, 20), box(210, 20), box(60, 40), box(160, 40), box(260, 40)].map((b) => ({ ...b, y0: b.cy - 4.5, y1: b.cy + 4.5 }))
    expect(readingOrder(staggered).map((r) => [r.cx, r.cy])).toEqual([[10, 20], [110, 20], [210, 20], [60, 40], [160, 40], [260, 40]])
  })
  it('keeps a whole tube that sits a pixel from the frame on paper', () => {
    const w = 300
    const h = 150
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const patch = (x0: number, rgb: number[]) => {
      for (let y = 60; y < 84; y++) for (let x = x0; x < x0 + 24; x++) data.set([...rgb, 255], (y * w + x) * 4)
    }
    patch(1, [235, 180, 40])
    patch(100, [225, 80, 120])
    patch(200, [235, 180, 40])
    expect(findRegions({ width: w, height: h, data }).regions.map((r) => r.x0)).toEqual([1, 100, 200])
    // Shaded or tinted paper in that one-pixel gap is still paper.
    for (const margin of [[203, 203, 203], [150, 150, 150], [255, 240, 200]]) {
      for (let y = 60; y < 84; y++) data.set([...margin, 255], y * w * 4)
      expect(findRegions({ width: w, height: h, data }).regions.map((r) => r.x0)).toEqual([1, 100, 200])
    }
  })
  it('drops a warm patch that stops just short of a dark frame edge', () => {
    const img = render(makeRun(608, 'typical', { kelvin: 5500, ev: 0, drift: 0 }), 0.5)
    const { regions: clean } = findRegions(img)
    const t = clean[3]
    const o = (Math.round(t.cy) * img.width + Math.round(t.cx)) * 4
    const tube = img.data.slice(o, o + 4)
    // One row of dark vignette at the top edge, the warm patch right below it.
    for (let y = 0; y < 9; y++) for (let x = 40; x < 80; x++) img.data.set(y < 1 ? [30, 25, 20, 255] : tube, (y * img.width + x) * 4)
    expect(findRegions(img).regions.map((r) => r.cx)).toEqual(clean.map((r) => r.cx))
    // The same patch with white paper above it is a whole tube, so it stays.
    for (let x = 40; x < 80; x++) img.data.set([255, 255, 255, 255], x * 4)
    expect(findRegions(img).regions).toHaveLength(clean.length + 1)
  })
  it('ignores a warm patch at the edge of the frame', () => {
    const img = render(makeRun(608, 'typical', { kelvin: 5500, ev: 0, drift: 0 }), 0.5)
    const { regions: clean } = findRegions(img)
    const t = clean[3]
    const o = (Math.round(t.cy) * img.width + Math.round(t.cx)) * 4
    const tube = img.data.slice(o, o + 4)
    for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) img.data.set(tube, (y * img.width + x) * 4)
    expect(findRegions(img).regions.map((r) => r.cx)).toEqual(clean.map((r) => r.cx))
  })
  it('keeps the tubes when a warm border runs along two edges of the frame', () => {
    // A wooden table showing down one side and across the top: one region whose box covers the whole photo.
    const img = render(makeRun(608, 'typical', { kelvin: 5500, ev: 0, drift: 0 }), 0.5)
    const { regions: clean } = findRegions(img)
    const t = clean[3]
    const o = (Math.round(t.cy) * img.width + Math.round(t.cx)) * 4
    const warm = img.data.slice(o, o + 4)
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) if (x < 12 || y < 12) img.data.set(warm, (y * img.width + x) * 4)
    expect(findRegions(img).regions.map((r) => r.cx)).toEqual(clean.map((r) => r.cx))
  })
  it('ignores the dark table along the edges, and the warm strip where it meets the paper', () => {
    // A phone photo cropped loose: dark table across the top and down the right, and a few pixels of
    // brown, blurred table-to-paper edge that stop short of the frame. None of it is a tube on paper.
    const img = render(makeRun(608, 'typical', { kelvin: 5500, ev: 0, drift: 0 }), 0.5)
    const { regions: clean } = findRegions(img)
    const { width: w, height: h } = img
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const table = y < 8 || x >= w - 8
        const blur = !table && (y < 12 || x >= w - 12) && (x + y) % 40 < 25
        if (table) img.data.set([30, 24, 20, 255], (y * w + x) * 4)
        else if (blur) img.data.set([85, 62, 45, 255], (y * w + x) * 4)
      }
    const { regions } = findRegions(img)
    expect(regions.map((r) => Math.round(r.cx))).toEqual(clean.map((r) => Math.round(r.cx)))
  })
  it('keeps a tube beside a pen mark out on the paper', () => {
    // Dark ink a few pixels from a tube isn't table: it doesn't reach the frame.
    const img = sheet(300, 150)
    paint(img, 100, 60, 107, 83, [235, 180, 40])
    paint(img, 92, 60, 96, 83, [30, 30, 30])
    expect(findRegions(img).regions).toHaveLength(1)
  })
  it('measures a close-up tube that fills much of the photo', () => {
    // Liquid covering most of a box a quarter of the photo across tints the white map there. It must not
    // become its own white, and the hue the tube has on the white paper stays within the range it reads.
    const img = sheet(300, 150)
    const colours = [[235, 180, 40], [225, 80, 120], [235, 180, 40]] as const
    colours.forEach((c, k) => paint(img, [4, 110, 216][k], 35, [4, 110, 216][k] + 79, 114, c))
    const { regions, paper } = findRegions(img)
    expect(regions).toHaveLength(3)
    regions.forEach((r, k) => {
      const f = measure(img, r, paper)!
      const lab = linToLab(...(colours[k].map((v) => LIN8[v]) as RGB))
      const hue = labHue(lab.a, lab.b)
      expect(f.clear).toBeGreaterThan(4000)
      expect(f.hueRange[0]).toBeLessThanOrEqual(hue + 0.5)
      expect(f.hueRange[1]).toBeGreaterThanOrEqual(hue - 0.5)
    })
  })
  it('marks a tube clipped when a channel of its liquid or of the paper it is read against is clipped', () => {
    // Seed 732 at 10000 K and +0.5 EV: the paper clipped in green and blue, the pale tube not at all.
    const clipped = (paper: number[], liquid: number[]) => {
      const img = sheet(300, 150)
      paint(img, 0, 0, 299, 149, paper)
      paint(img, 140, 40, 159, 109, liquid)
      const found = findRegions(img)
      expect(found.regions).toHaveLength(1)
      return measure(img, found.regions[0], found.paper)!.clipped
    }
    expect(clipped([236, 240, 238], [215, 139, 151])).toBe(false)
    expect(clipped([236, 254, 255], [215, 139, 151])).toBe(true)
    expect(clipped([249, 249, 249], [215, 139, 151])).toBe(false)
    expect(clipped([236, 240, 238], [252, 180, 60])).toBe(true)
  })
  // A lamp of this colour at one end of the photo, fading to daylight at the other.
  const underLamp = (img: Img, kelvin: number, fromLeft: boolean): Img => {
    const day = lightCast(6500)
    const lit = lightCast(kelvin)
    const gain = norm([lit[0] / day[0], lit[1] / day[1], lit[2] / day[2]])
    const data = new Uint8ClampedArray(img.data)
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const t = fromLeft ? x / (img.width - 1) : 1 - x / (img.width - 1)
        const o = (y * img.width + x) * 4
        for (let c = 0; c < 3; c++) data[o + c] = Math.round(toSrgb(LIN8[data[o + c]] * (gain[c] + (1 - gain[c]) * t)) * 255)
      }
    return { ...img, data }
  }
  // Every tube is still found, and none gets a call it didn't get in even light. A tube may be held.
  const sameUnderLamp = (img: Img, roles: Role[], kelvin: number, fromLeft: boolean) => {
    const read = (im: Img) => {
      const { regions, paper } = findRegions(im)
      return { n: regions.length, calls: readCalibrated(regions.map((r) => measure(im, r, paper)), roles, model, band).tubes.map((t) => t.call) }
    }
    const clean = read(img)
    const lamp = read(underLamp(img, kelvin, fromLeft))
    expect(lamp.n).toBe(clean.n)
    expect(lamp.calls.filter((c, i) => c !== clean.calls[i] && c !== 'held')).toEqual([])
  }
  const lamps = [3000, 2400].flatMap((kelvin) => [true, false].map((fromLeft) => ({ kelvin, fromLeft })))
  it('reads the same tubes the same way under a warm lamp on one side', { timeout: 30_000 }, () => {
    // A 3000 or 2400 K lamp at one end of the rack and daylight at the other: the paper goes from orange to
    // white. Seed 70's positives 5 and 8 turned only part way: uncorrected, the cast reads them as negative.
    for (const spec of [1, 2, 3].map((seed) => makeRun(seed, 'typical', { kelvin: 5500, ev: 0, drift: 0 })).concat(makeRun(70)))
      for (const { kelvin, fromLeft } of lamps) sameUnderLamp(render(spec, 0.5), spec.tubes.map((t) => t.role), kelvin, fromLeft)
  })
  it('reads two rows of five the same way under a warm lamp on one side', { timeout: 30_000 }, () => {
    // A tube's found region can reach into the lamp-warmed paper beside it. Told from paper against one white
    // for the whole area, that paper counted as liquid: seed 14's negative sample 3 read positive at 2400 K.
    // (With the lamp at the left, seeds 14 and 59 lose a tube to the finder; the grower taps it back.)
    for (const [seed, sides] of [[14, [false]], [59, [false]], [93, [true, false]]] as const) {
      const spec = makeRun(seed)
      const img = render(spec, 0.5)
      const [W, H] = [img.width, img.height]
      const w = Math.floor(W / 2)
      const rows: Img = { width: w, height: 2 * H, data: new Uint8ClampedArray(w * 2 * H * 4) }
      for (let y = 0; y < 2 * H; y++)
        for (let x = 0; x < w; x++) {
          const from = (y < H ? y * W + x : (y - H) * W + x + Math.round(W / 2)) * 4
          rows.data.set(img.data.subarray(from, from + 4), (y * w + x) * 4)
        }
      for (const fromLeft of sides) sameUnderLamp(rows, spec.tubes.map((t) => t.role), 2400, fromLeft)
    }
  })
  it('matches every tube in clean runs', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(readSynthetic(makeRun(seed, 'typical', { ev: 0 }), 0.5).missed).toBe(0)
  })
  it('skips washed-out pixels inside a disc and counts them as glare', () => {
    // A yellow disc on white paper, with a white glint in the middle.
    const w = 40
    const data = new Uint8ClampedArray(w * w * 4)
    for (let i = 0; i < w * w; i++) {
      const d = Math.hypot((i % w) - 20, Math.floor(i / w) - 20)
      data.set(d < 4 || d > 10.5 ? [255, 255, 255, 255] : [230, 200, 60, 255], i * 4)
    }
    const img: Img = { width: w, height: w, data }
    const f = measure(img, discRegion(20, 20, 10), [0.9, 0.9, 0.9])!
    expect(f.glare).toBeGreaterThan(0)
    expect(f.raw).toEqual([230, 200, 60])
    expect(measure(img, discRegion(20, 20, 10, 5), [0.9, 0.9, 0.9])!.glare).toBe(0)
  })
  it('finds a pale tube tip whose own glow tints the paper around it', () => {
    // PathoScan's case-study photo: the negative control's tip is pale pink, and the tube wall around it
    // glows faintly pink, pale enough to pass as paper. Judged against that glow as its white, the tip
    // isn't coloured at all. Liquid is told from paper against the map's white, as the finder does.
    const img = sheet(200, 200)
    paint(img, 0, 0, 199, 199, [230, 230, 230])
    for (let y = 80; y < 120; y++)
      for (let x = 80; x < 120; x++) {
        const d = Math.hypot(x - 100, y - 100)
        if (d < 14) img.data.set(d < 5 ? [205, 150, 158] : [228, 206, 212], (y * 200 + x) * 4)
      }
    const f = measure(img, discRegion(100, 100, 5), [LIN8[230], LIN8[230], LIN8[230]])
    expect(f?.raw).toEqual([205, 150, 158])
    expect(f!.clear).toBeGreaterThan(50)
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
