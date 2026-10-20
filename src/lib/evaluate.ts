// Turning synthetic runs into scored reads. The eval script and the page share this file, so the runs on the
// page and the numbers in data/eval.json come from the same code path.

import { findRegions, measure, type Features } from './find'
import { readCalibrated, readNaive, type Band, type Call, type Model } from './readers'
import { liquidCentre, makeRun, render, type Conditions, type Kind, type Role, type RunSpec, type ScenarioId, type Truth } from './synth'

export interface ReadRun {
  spec: RunSpec
  roles: Role[]
  feats: (Features | null)[]
  /** Tubes the finder didn't find a region for. */
  missed: number
}

/** Render a run, find its liquid, and match each found region to the tube it belongs to. */
export function readSyntheticFull(spec: RunSpec, scale: number) {
  const img = render(spec, scale)
  const { regions, paper } = findRegions(img)
  const matched = spec.tubes.map((_, i) => {
    const x = liquidCentre(spec, i).x * scale
    return regions.find((r) => x >= r.x0 - 2 && x <= r.x1 + 2) ?? null
  })
  const feats = matched.map((r) => (r ? measure(img, r, paper) : null))
  return { img, regions: matched, feats }
}

export function readSynthetic(spec: RunSpec, scale: number): ReadRun {
  const { feats } = readSyntheticFull(spec, scale)
  return { spec, roles: spec.tubes.map((t) => t.role), feats, missed: feats.filter((f) => !f).length }
}

export type Confusion = Record<Truth, Record<Call, number>>
export const emptyConfusion = (): Confusion => ({ pos: { pos: 0, held: 0, neg: 0 }, neg: { pos: 0, held: 0, neg: 0 } })

export interface Scores {
  confusion: Confusion
  samples: number
  /** Wrong calls: a positive called negative or a negative called positive. */
  wrong: number
  held: number
  sensitivity: number
  specificity: number
  /** Share right among the tubes it called. */
  accuracyCalled: number
}

export function score(c: Confusion): Scores {
  const P = c.pos.pos + c.pos.held + c.pos.neg
  const N = c.neg.pos + c.neg.held + c.neg.neg
  const called = c.pos.pos + c.pos.neg + c.neg.pos + c.neg.neg
  return {
    confusion: c,
    samples: P + N,
    wrong: c.pos.neg + c.neg.pos,
    held: c.pos.held + c.neg.held,
    sensitivity: P ? c.pos.pos / P : NaN,
    specificity: N ? c.neg.neg / N : NaN,
    accuracyCalled: called ? (c.pos.pos + c.neg.neg) / called : NaN,
  }
}

export interface ReaderParams {
  cut: number
  model: Model
  band: Band
}

/** Score both readers on a set of read runs. Only samples count; controls are the scale, not the test. */
export function scoreRuns(runs: ReadRun[], p: ReaderParams, filter?: (kind: Kind, scenario: ScenarioId) => boolean) {
  const naive = emptyConfusion()
  const calibrated = emptyConfusion()
  for (const run of runs) {
    const n = readNaive(run.feats, p.cut)
    const c = readCalibrated(run.feats, run.roles, p.model, p.band)
    run.spec.tubes.forEach((t, i) => {
      if (t.role !== 'sample') return
      if (filter && !filter(t.kind, run.spec.scenario)) return
      naive[t.truth][n.tubes[i].call]++
      calibrated[t.truth][c.tubes[i].call]++
    })
  }
  return { naive: score(naive), calibrated: score(calibrated) }
}

/** The run mix used for training and testing: half typical runs, the rest split over the hard cases. */
export function scenarioFor(seed: number): ScenarioId {
  const k = seed % 10
  return k < 5 ? 'typical' : (['weak-pc', 'acidic', 'glare', 'bubble', 'low-volume'] as const)[k - 5]
}

export function makeSet(firstSeed: number, n: number, scale: number, cond?: Conditions): ReadRun[] {
  return Array.from({ length: n }, (_, i) => readSynthetic(makeRun(firstSeed + i, scenarioFor(firstSeed + i), cond), scale))
}

/** One-feature logistic regression by Newton's method. */
export function fitLogistic(xs: number[], ys: number[]): Model {
  let w0 = 0
  let w1 = 1
  for (let it = 0; it < 50; it++) {
    let g0 = 0
    let g1 = 0
    let h00 = 1e-6
    let h01 = 0
    let h11 = 1e-6
    for (let i = 0; i < xs.length; i++) {
      const p = 1 / (1 + Math.exp(-(w0 + w1 * xs[i])))
      const e = p - ys[i]
      const v = p * (1 - p)
      g0 += e
      g1 += e * xs[i]
      h00 += v
      h01 += v * xs[i]
      h11 += v * xs[i] * xs[i]
    }
    const det = h00 * h11 - h01 * h01
    const d0 = (h11 * g0 - h01 * g1) / det
    const d1 = (h00 * g1 - h01 * g0) / det
    w0 -= d0
    w1 -= d1
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break
  }
  return { w0, w1 }
}

/** The single hue cut that gets the most training samples right. */
export function fitCut(hues: number[], ys: number[]): number {
  let best = { cut: 0, right: -1 }
  for (let cut = -30; cut <= 80; cut += 0.5) {
    let right = 0
    hues.forEach((h, i) => (right += (h >= cut ? 1 : 0) === ys[i] ? 1 : 0))
    if (right > best.right) best = { cut, right }
  }
  return best.cut
}
