// The Photo screen's reader steps without the screen, so the tests and scripts/check-app-path.ts run exactly
// what the app runs. Pixels in, rings and a read out; the reader itself is src/lib, unchanged.

import { params } from '../../data/eval.json'
import { median } from '../lib/color'
import { discRegion, findRegions, globalPaper, measure, type Region } from '../lib/find'
import { readCalibrated, type Band, type Model, type RunRead } from '../lib/readers'
import type { Img, Role } from '../lib/synth'

export const MODEL: Model = params.model
export const BAND: Band = params.band

/** How far from a ring's centre a finger still hits it, in CSS pixels, when no neighbour is closer. */
export const REACH_PX = 22

/** A ring's radius in image pixels. */
export const radius = (r: Region) => r.r ?? Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2

/** Half a ring's narrow side: a disc this size sits inside the liquid instead of reaching the paper. */
const inner = (r: Region) => r.r ?? Math.min(r.x1 - r.x0, r.y1 - r.y0) / 2

/** The tubes the finder sees, in reading order, so the keyboard steps through them along the rows. */
export const findRings = (img: Img): Region[] => findRegions(img).regions

/**
 * The ring a tap at (x, y) lands on: the ring with the nearest centre, if the tap is under half the way to
 * that ring's nearest neighbour and under half the row's usual spacing (so a tap between two tubes, or on a
 * missed tube beside a close neighbour, hits neither), and within `reach` of the centre or inside the ring.
 * -1 for none.
 */
export function ringAt(rings: Region[], x: number, y: number, reach: number): number {
  const d = rings.map((r) => Math.hypot(r.cx - x, r.cy - y))
  const i = d.indexOf(Math.min(...d))
  if (i < 0) return -1
  const nearest = rings.map((r, k) => Math.min(...rings.map((o, j) => (j === k ? Infinity : Math.hypot(o.cx - r.cx, o.cy - r.cy)))))
  return d[i] < Math.min(nearest[i], median(nearest)) / 2 && d[i] <= Math.max(reach, radius(rings[i])) ? i : -1
}

/**
 * A tap while fixing rings. On a ring it removes it (a finger, a petal, a pen mark). On empty paper it adds a
 * ring for a tube the finder missed, as wide as the median ring's narrow side so it sits inside the liquid
 * (sized by the long side, as scripts/read-runs.ts does, it reads paper as glare). An added ring goes last.
 */
export function tapRings(rings: Region[], x: number, y: number, reach: number): Region[] {
  const i = ringAt(rings, x, y, reach)
  return i >= 0 ? removeRing(rings, i) : addRing(rings, x, y)
}

export const removeRing = (rings: Region[], i: number) => rings.filter((_, j) => j !== i)
export const addRing = (rings: Region[], x: number, y: number) => [...rings, discRegion(x, y, median(rings.map(inner)) || 12)]

/** The labels on the grower's paper, in the order they tap the tubes. */
export const LABELS = ['+', '−', '1', '2', '3', '4', '5', '6', '7', '8']
/** Rings stored in label order have these roles: never worked out from where a tube sits in the photo. */
export const ROLES: Role[] = LABELS.map((l) => (l === '+' ? 'pc' : l === '−' ? 'nc' : 'sample'))

/**
 * A tap while labelling: an unlabelled ring gets the next label; a labelled one loses its label and every
 * label after it, so a wrong tap is undone by tapping it again. `order` holds ring indices in label order.
 */
export const tapInOrder = (order: number[], i: number) =>
  order.includes(i) ? order.slice(0, order.indexOf(i)) : order.length < LABELS.length ? [...order, i] : order

export function readTubes(img: Img, rings: Region[], roles: Role[]): RunRead {
  const paper = globalPaper(img)
  return readCalibrated(
    rings.map((r) => measure(img, r, paper)),
    roles,
    MODEL,
    BAND,
  )
}
