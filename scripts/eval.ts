// Fits both readers on synthetic training runs and scores them on held-out runs. Writes data/eval.json,
// which the page reads. Run: npm run eval (about two minutes).

import { writeFileSync } from 'node:fs'
import { fitCut, fitLogistic, makeSet, scoreRuns, type ReadRun, type ReaderParams } from '../src/lib/evaluate'
import { readCalibrated, type Band } from '../src/lib/readers'
import { DRIFT_RANGE, PRIOR, SCENARIOS, type Conditions, type Kind } from '../src/lib/synth'

export const SCALE = 0.5
const TRAIN = { first: 1, n: 600 }
const TEST = { first: 100001, n: 2000 }
const SWEEP = { first: 300001, n: 40 }
const BAND: Band = { lo: 0.2, hi: 0.8 }

const t0 = Date.now()
const train = makeSet(TRAIN.first, TRAIN.n, SCALE)

// Naive: the single raw-hue cut that gets the most training samples right, over every training light.
const hues: number[] = []
const ys: number[] = []
for (const r of train)
  r.spec.tubes.forEach((t, i) => {
    if (t.role !== 'sample' || !r.feats[i]) return
    hues.push(r.feats[i]!.rawHue)
    ys.push(t.truth === 'pos' ? 1 : 0)
  })
const cut = fitCut(hues, ys)

// Calibrated: logistic on the control-relative score s, over the samples the QC lets through.
const ss: number[] = []
const sy: number[] = []
for (const r of train) {
  const read = readCalibrated(r.feats, r.roles, { w0: 0, w1: 1 }, { lo: 0.5, hi: 0.5 })
  r.spec.tubes.forEach((t, i) => {
    const tr = read.tubes[i]
    if (t.role !== 'sample' || tr.p === undefined || tr.s === undefined) return
    ss.push(tr.s)
    sy.push(t.truth === 'pos' ? 1 : 0)
  })
}
const model = fitLogistic(ss, sy)
const params: ReaderParams = { cut, model, band: BAND }
console.log('fit', { cut, model, trainSamples: hues.length, logisticSamples: ss.length })

const test = makeSet(TEST.first, TEST.n, SCALE)
const missed = (runs: ReadRun[]) => runs.reduce((a, r) => a + r.missed, 0)
const all = scoreRuns(test, params)
const byScenario = Object.fromEntries(SCENARIOS.map((s) => [s.id, scoreRuns(test, params, (_k, sc) => sc === s.id)]))
const kinds: Kind[] = ['yellow', 'orange', 'unchanged', 'clear-neg', 'acidic']
const byKind = Object.fromEntries(kinds.map((k) => [k, scoreRuns(test, params, (kind) => kind === k)]))
console.log('test', { naiveWrong: all.naive.wrong, calWrong: all.calibrated.wrong, calHeld: all.calibrated.held, samples: all.naive.samples })

const sweep = (key: keyof Conditions, xs: number[]) =>
  xs.map((x) => {
    const cond: Conditions = { kelvin: 5500, ev: 0, drift: 0, [key]: x }
    const runs = makeSet(SWEEP.first, SWEEP.n, SCALE, cond)
    const s = scoreRuns(runs, params)
    const pick = (v: typeof s.naive) => ({ wrong: v.wrong, held: v.held, samples: v.samples })
    return { x, naive: pick(s.naive), calibrated: pick(s.calibrated), missed: missed(runs) }
  })
const range = (a: number, b: number, step: number) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(3))
const sweeps = {
  kelvin: sweep('kelvin', range(2500, 8000, 500)),
  ev: sweep('ev', range(-2, 2, 0.5)),
  drift: sweep('drift', range(-0.3, 0.3, 0.05)),
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  note: 'Synthetic runs only. Every number here comes from scripts/eval.ts on the code in src/lib.',
  setup: {
    scale: SCALE,
    imageSize: [500, 210],
    prior: PRIOR,
    driftRange: DRIFT_RANGE,
    lightRange: { kelvin: [2700, 6500], ev: [-1, 1] },
    scenarioMix: 'half typical runs, a tenth each of the five hard cases',
    train: { runs: TRAIN.n, seeds: [TRAIN.first, TRAIN.first + TRAIN.n - 1], samples: hues.length },
    test: { runs: TEST.n, seeds: [TEST.first, TEST.first + TEST.n - 1], samples: all.naive.samples },
    sweep: { runsPerPoint: SWEEP.n, seeds: [SWEEP.first, SWEEP.first + SWEEP.n - 1], fixed: { kelvin: 5500, ev: 0, drift: 0 } },
  },
  params,
  test: { ...all, finderMissed: missed(test), byScenario, byKind },
  sweeps,
  seconds: Math.round((Date.now() - t0) / 1000),
}
writeFileSync(new URL('../data/eval.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log('wrote data/eval.json in', out.seconds, 's')
