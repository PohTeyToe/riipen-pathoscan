// The Photo screen's reader steps without the screen, so the tests and scripts/check-app-path.ts run exactly
// what the app runs. Pixels in, rings and a read out; the reader itself is src/lib, unchanged.

import { params } from '../../data/eval.json'
import { median } from '../lib/color'
import { discRegion, findRegions, measure, type Region } from '../lib/find'
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

/** A label's size on a photo `width` pixels wide: about 18 CSS pixels however many pixels the photo has. */
export const labelSize = (width: number) => width / 22

/** The width of a ring's line, in CSS pixels, while the rings are fixed. */
export const RING_STROKE_PX = 3

/**
 * The ring drawn round a tube on a photo `width` pixels wide: an ellipse just outside the liquid's box, never
 * smaller than a label so a ring on a small tube can still be seen. Its line is RING_STROKE_PX wide, centred
 * on the ellipse. The Photo screen draws this and tapRings hits it.
 */
export function ringShape(r: Region, width: number) {
  const f = labelSize(width)
  return {
    cx: (r.x0 + r.x1) / 2,
    cy: (r.y0 + r.y1) / 2,
    rx: Math.max((r.x1 - r.x0) / 2 + f * 0.2, f * 0.4),
    ry: Math.max((r.y1 - r.y0) / 2 + f * 0.2, f * 0.4),
  }
}

/**
 * A tap while fixing rings, on a photo `width` pixels wide shown at `px` photo pixels to a CSS pixel. What
 * the grower sees is what they tap: a tap on a ring as painted, its line included, removes it (a finger, a
 * petal, a pen mark); where painted rings overlap, the one the tap is deepest inside. Anywhere else the tap
 * adds a ring for a tube the finder missed, as wide as the median ring's narrow side so it sits inside the
 * liquid (sized by the long side, as scripts/read-runs.ts does, it reads paper as glare). An added ring goes
 * last. A tap just off a ring adds one; the count says so, and a tap on the new ring takes it off.
 */
export function tapRings(rings: Region[], x: number, y: number, width: number, px: number): Region[] {
  const line = (RING_STROKE_PX / 2) * px
  const depth = rings.map((r) => {
    const e = ringShape(r, width)
    return ((x - e.cx) / (e.rx + line)) ** 2 + ((y - e.cy) / (e.ry + line)) ** 2
  })
  const i = depth.indexOf(Math.min(...depth))
  return depth[i] <= 1 ? removeRing(rings, i) : [...rings, discRegion(x, y, median(rings.map(inner)) || 12)]
}

export const removeRing = (rings: Region[], i: number) => rings.filter((_, j) => j !== i)

/**
 * The labels on a full kit's paper, in the order the grower taps the tubes: +, −, then samples 1 to 8. A run
 * with fewer samples takes the first labels.
 */
export const LABELS = ['+', '−', '1', '2', '3', '4', '5', '6', '7', '8']
/** Rings stored in label order have these roles: never worked out from where a tube sits in the photo. */
export const ROLES: Role[] = LABELS.map((l) => (l === '+' ? 'pc' : l === '−' ? 'nc' : 'sample'))
/** The fewest tubes a run can be read from: both controls and one sample. */
export const MIN_TUBES = 3

/**
 * A tap while labelling: an unlabelled ring gets the next label; a labelled one loses its label and every
 * label after it, so a wrong tap is undone by tapping it again. `order` holds ring indices in label order.
 */
export const tapInOrder = (order: number[], i: number) =>
  order.includes(i) ? order.slice(0, order.indexOf(i)) : order.length < LABELS.length ? [...order, i] : order

export function readTubes(img: Img, rings: Region[], roles: Role[]): RunRead {
  return readCalibrated(
    rings.map((r) => measure(img, r)),
    roles,
    MODEL,
    BAND,
  )
}
