// The two readers. Both get the same measured colours (find.ts); they differ only in how they call them.
//
// Naive: one fixed hue cut on the raw camera colour. No controls, no "can't tell".
// Calibrated: white-balanced on the paper next to each tube, scored against the run's own controls in
// CIELAB, mapped to a probability by a one-feature logistic model, with a band where it holds the call.

import { median } from './color'
import type { Features } from './find'
import type { Role } from './synth'

export type Call = 'pos' | 'neg' | 'held'

export interface TubeRead {
  call: Call
  reason: string
  /** Calibrated only: position between the controls (0 = negative control, 1 = positive control). */
  s?: number
  /** Calibrated only: the model's probability that the tube changed colour like the positive control. */
  p?: number
  /** Calibrated only: the lowest and highest p the white allows (see Features.hueRange). */
  pRange?: [number, number]
}

export interface RunRead {
  /** 'failed' when the reader refused the run: every sample is held and no call can be trusted. */
  status: 'ok' | 'failed'
  tubes: TubeRead[]
  /** Run-level checks that failed or need a look. */
  flags: string[]
  /** Calibrated only: the control hues the scale was built from. */
  scale?: { nc: number; pc: number }
}

export interface Model {
  w0: number
  w1: number
}

export interface Band {
  lo: number
  hi: number
}

/** Calibrated QC thresholds. */
export const QC = {
  /** Lab hue degrees the positive control must sit above the negative one. */
  minControlGap: 20,
  /** Clear liquid pixels needed to read a tube. */
  minClear: 25,
  /** A tube with less chroma than this share of the controls' is too pale to read. */
  minChromaShare: 0.3,
  /** A sample this far past the positive control counts toward the "weak control" flag. */
  weakControlS: 1.15,
  /**
   * A found sample region whose box is more than this many times the median found region's is held: it has
   * likely spread into lit paper or the table, so its colour isn't the liquid's. Controls are left out: they set
   * the scale whatever their size.
   */
  maxAreaShare: 3,
  /**
   * Lab hue degrees a tube's hue may be off by at best. Two photos of the same tubes differ by about this much
   * (the JPEG, which pixels count as liquid, the white to the last 8-bit step), so a call needs this margin.
   */
  hueFloor: 1,
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
const logit = (p: number) => Math.log(p / (1 - p))

/** The score where the model's probability equals p: how a band edge is drawn on the scale. */
export const sAt = (model: Model, p: number) => (logit(p) - model.w0) / model.w1
export const pAt = (model: Model, s: number) => sigmoid(model.w0 + model.w1 * s)

export function readNaive(feats: (Features | null)[], cut: number): RunRead {
  return {
    status: 'ok',
    flags: [],
    tubes: feats.map((f) =>
      !f
        ? { call: 'neg', reason: 'No colour found, so it reads as unchanged.' }
        : f.rawHue >= cut
          ? { call: 'pos', reason: `Hue ${f.rawHue.toFixed(0)}° is at or past the ${cut.toFixed(0)}° cut.` }
          : { call: 'neg', reason: `Hue ${f.rawHue.toFixed(0)}° is below the ${cut.toFixed(0)}° cut.` },
    ),
  }
}

/** Positive if the raw hue is past the midpoint between the two controls' raw hues. */
export function readMidpoint(feats: (Features | null)[], roles: Role[]): RunRead {
  const hue = (role: Role) => mean(feats.filter((f, i) => f && roles[i] === role).map((f) => f!.rawHue))
  const mid = (hue('pc') + hue('nc')) / 2
  return {
    status: Number.isNaN(mid) ? 'failed' : 'ok',
    flags: [],
    tubes: feats.map((f) =>
      !f || Number.isNaN(mid)
        ? { call: 'held', reason: 'Needs both controls and a colour.' }
        : { call: f.rawHue >= mid ? 'pos' : 'neg', reason: `Midpoint ${mid.toFixed(1)}°` },
    ),
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const chroma = (f: Features) => Math.hypot(f.lab.a, f.lab.b)

export function readCalibrated(feats: (Features | null)[], roles: Role[], model: Model, band: Band): RunRead {
  const pcs = feats.filter((f, i) => f && roles[i] === 'pc') as Features[]
  const ncs = feats.filter((f, i) => f && roles[i] === 'nc') as Features[]
  const flags: string[] = []
  const held = (reason: string): TubeRead => ({ call: 'held', reason })

  if (pcs.length === 0 || ncs.length === 0) {
    const missing = pcs.length === 0 && ncs.length === 0 ? 'either control' : pcs.length === 0 ? 'a positive control' : 'a negative control'
    flags.push(`Can't find ${missing}, so there's no scale to read against. Retake the photo with both controls in clear view.`)
    return { status: 'failed', flags, tubes: feats.map(() => held(flags[0])) }
  }
  // Several positive controls: read against the one that turned furthest, and say if another didn't. A
  // positive control that fails to turn is a known failure mode. A negative control that turned is
  // contamination, which puts every call in its group in doubt, so negative controls that disagree hold
  // the group instead of being averaged.
  const pcHues = pcs.map((f) => f.labHue)
  const ncHues = ncs.map((f) => f.labHue)
  const hPc = Math.max(...pcHues)
  const hNc = mean(ncHues)
  const cRef = mean([...pcs, ...ncs].map(chroma))
  const scale = { nc: hNc, pc: hPc }
  const notRead = (flag: string): RunRead => {
    flags.push(flag)
    return { status: 'failed', flags, scale, tubes: feats.map((_, i) => (roles[i] === 'sample' ? held(flag) : controlRead(roles[i]))) }
  }
  const ncSpread = Math.max(...ncHues) - Math.min(...ncHues)
  if (ncs.length > 1 && ncSpread >= (hPc - Math.min(...ncHues)) / 2)
    return notRead(`The negative controls disagree (${ncSpread.toFixed(0)}° apart); one may be contaminated. Run not read; check them.`)
  if (hPc - hNc < QC.minControlGap)
    return notRead(
      hPc <= hNc
        ? 'The positive control is pinker than the negative one. Run not read; check the controls.'
        : `The controls are only ${(hPc - hNc).toFixed(0)}° apart, too close to read against. Run not read; rerun with fresh reagents.`,
    )

  if ([...pcs, ...ncs].some((f) => f.clear < QC.minClear)) flags.push('A control has very few clear pixels, so the scale itself is uncertain.')
  if (pcHues.some((h) => h - hNc < (hPc - hNc) / 2))
    flags.push('One positive control barely changed colour. Read against the one that did; check the other before trusting the run.')

  // Each hue is known only to within its range (uneven light) and never closer than QC.hueFloor, the
  // controls' too. A tube is called only if every end of its own range and the controls' gives that call.
  const range = (f: Features) => [Math.min(f.hueRange[0], f.labHue - QC.hueFloor), Math.max(f.hueRange[1], f.labHue + QC.hueFloor)]
  const pcRange = [0, 1].map((k) => Math.max(...pcs.map((f) => range(f)[k])))
  const ncRange = [0, 1].map((k) => mean(ncs.map((f) => range(f)[k])))
  const sRange = (f: Features): [number, number] => {
    const ss = range(f).flatMap((h) => ncRange.flatMap((n) => pcRange.map((pc) => (pc > n ? (h - n) / (pc - n) : NaN))))
    return ss.some(Number.isNaN) ? [-Infinity, Infinity] : [Math.min(...ss), Math.max(...ss)]
  }

  const areas = feats.flatMap((f) => (f?.area ? [f.area] : []))
  const maxArea = areas.length >= 3 ? QC.maxAreaShare * median(areas) : Infinity
  let lightHeld = 0
  const tubes = feats.map((f, i): TubeRead => {
    if (roles[i] !== 'sample') return controlRead(roles[i])
    if (!f) return held('No liquid colour found.')
    if (f.clear < QC.minClear) return held('Too few clear pixels (glare, a bubble or low volume).')
    if (f.glare > f.clear * 1.5) return held('Mostly glare or reflection.')
    if ((f.area ?? 0) > maxArea) return held('Much bigger than the other tubes, so it may take in paper or table. Read by eye.')
    const s = (f.labHue - hNc) / (hPc - hNc)
    if (chroma(f) < QC.minChromaShare * cRef) return { ...held('Too pale to read against the controls.'), s }
    const p = pAt(model, s)
    const pRange = sRange(f).map((x) => pAt(model, x)) as [number, number]
    if (pRange[0] >= band.hi) return { call: 'pos', s, p, pRange, reason: `${pct(p)} like the positive control.` }
    if (pRange[1] <= band.lo) return { call: 'neg', s, p, pRange, reason: `${pct(1 - p)} like the negative control.` }
    if (p > band.lo && p < band.hi) return { call: 'held', s, p, pRange, reason: `Between the controls (${pct(p)}). Read by eye.` }
    lightHeld++
    return { call: 'held', s, p, pRange, reason: `The paper around it doesn't pin down its light, so it could be ${pct(pRange[0])} to ${pct(pRange[1])} like the positive control. Read by eye.` }
  })
  const past = tubes.filter((t, i) => roles[i] === 'sample' && (t.s ?? 0) > QC.weakControlS).length
  if (past > 0) flags.push(`The positive control is weaker than ${past} sample${past > 1 ? 's' : ''}. Check it before trusting the run.`)
  if (lightHeld > 0) flags.push(`${lightHeld} tube${lightHeld > 1 ? 's were' : ' was'} held only because the light on ${lightHeld > 1 ? 'them' : 'it'} isn't clear. Retake the photo in even light, with paper in view around each tube, to read ${lightHeld > 1 ? 'them' : 'it'}.`)
  return { status: 'ok', tubes, flags, scale }
}

const controlRead = (role: Role): TubeRead =>
  role === 'pc' ? { call: 'pos', reason: 'Positive control. Sets the yellow end of the scale.' } : { call: 'neg', reason: 'Negative control. Sets the pink end of the scale.' }

const pct = (p: number) => `${Math.round(p * 100)}%`

/**
 * Run a control-based reader separately on each group of tubes (a plate can hold two assays, each with its
 * own controls), then put the reads back in the original order. Group names prefix the run flags. The plate
 * counts as failed if any group failed.
 */
export function readByGroup(
  groups: string[],
  read: (idx: number[]) => RunRead,
): RunRead {
  const names = [...new Set(groups)]
  const tubes: TubeRead[] = new Array(groups.length)
  const flags: string[] = []
  let scale: RunRead['scale']
  let status: RunRead['status'] = 'ok'
  for (const g of names) {
    const idx = groups.flatMap((x, i) => (x === g ? [i] : []))
    const r = read(idx)
    idx.forEach((i, k) => (tubes[i] = r.tubes[k]))
    flags.push(...r.flags.map((f) => (names.length > 1 && g ? `${g}: ${f}` : f)))
    scale ??= r.scale
    if (r.status === 'failed') status = 'failed'
  }
  return { status, tubes, flags, scale }
}
