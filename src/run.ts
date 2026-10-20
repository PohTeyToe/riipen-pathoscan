// The page's view of a synthetic run: drawn, found, measured and read by all three rules, at the
// parameters the eval fit. The eval script and the page share every step of this through src/lib.

import evalData from '../data/eval.json'
import { readSyntheticFull } from './lib/evaluate'
import type { Features } from './lib/find'
import { readCalibrated, readMidpoint, readNaive, type Band, type Call, type Model, type RunRead } from './lib/readers'
import { liquidCentre, makeRun, W, type Conditions, type Img, type Kind, type Role, type ScenarioId, type Truth } from './lib/synth'

export const MODEL: Model = evalData.params.model
export const BAND: Band = evalData.params.band
export const CUT: number = evalData.params.cut

/** Draw scale for runs on the page: 1000 by 420 pixels. */
export const SCALE = 1

export const KIND_WORD: Record<Kind, string> = {
  control: 'control',
  yellow: 'positive that turned yellow',
  orange: 'weak positive that only reached orange',
  unchanged: 'positive whose colour never changed enough to see',
  'clear-neg': 'negative that stayed pink',
  acidic: 'negative turned orange by an acidic extract',
}

export interface RunView {
  img: Img
  labels: string[]
  roles: Role[]
  truth: Truth[]
  kinds: Kind[]
  feats: (Features | null)[]
  /** Tube centre as a share of the image width, for lining things up under each tube. */
  x: number[]
  /** Liquid centre in image pixels, for overlays. */
  centre: { x: number; y: number }[]
  naive: RunRead
  midpoint: RunRead
  calibrated: RunRead
}

export function readRun(seed: number, scenario: ScenarioId, cond: Conditions): RunView {
  const spec = makeRun(seed, scenario, cond)
  const { img, feats } = readSyntheticFull(spec, SCALE)
  const roles = spec.tubes.map((t) => t.role)
  let n = 0
  return {
    img,
    labels: roles.map((r) => (r === 'pc' ? 'PC' : r === 'nc' ? 'NC' : String(++n))),
    roles,
    truth: spec.tubes.map((t) => t.truth),
    kinds: spec.tubes.map((t) => t.kind),
    feats,
    x: spec.tubes.map((_, i) => liquidCentre(spec, i).x / W),
    centre: spec.tubes.map((_, i) => {
      const c = liquidCentre(spec, i)
      return { x: c.x * SCALE, y: c.y * SCALE }
    }),
    naive: readNaive(feats, CUT),
    midpoint: readMidpoint(feats, roles),
    calibrated: readCalibrated(feats, roles, MODEL, BAND),
  }
}

/** A sample's call is wrong when it commits to the side its truth isn't on. Held is never wrong. */
export const isWrong = (role: Role, call: Call, truth: Truth | null | undefined) => role === 'sample' && !!truth && call !== 'held' && call !== truth

/** "4", "4 and 8", "1, 3 and 5". */
export function listTubes(xs: string[]) {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}
