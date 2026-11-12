// The Photo screen's reader steps without the screen, so the tests and scripts/check-app-path.ts run exactly
// what the app runs. Pixels in, rings and a read out; the reader itself is src/lib, unchanged.

import { params } from '../../data/eval.json'
import { median } from '../lib/color'
import { discRegion, findRegions, globalPaper, measure, readingOrder, type Region } from '../lib/find'
import { readCalibrated, type Band, type Model, type RunRead } from '../lib/readers'
import type { Img, Role } from '../lib/synth'

export const MODEL: Model = params.model
export const BAND: Band = params.band

/** How far outside a ring's box a finger still hits it, in CSS pixels. */
export const REACH_PX = 12

/** A ring's radius in image pixels. */
export const radius = (r: Region) => r.r ?? Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2

/** The tubes the finder sees, in reading order. */
export const findRings = (img: Img): Region[] => findRegions(img).regions

/**
 * The ring a tap at (x, y) lands on: the one whose box is nearest, within `reach` of it, and of two boxes the
 * tap is inside, the one with the nearer centre. -1 for none.
 */
export function ringAt(rings: Region[], x: number, y: number, reach: number): number {
  let hit = -1
  let best = [Infinity, Infinity]
  rings.forEach((r, i) => {
    const d = [Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1)), Math.hypot(r.cx - x, r.cy - y)]
    if (d[0] <= reach && (d[0] < best[0] || (d[0] === best[0] && d[1] < best[1]))) [hit, best] = [i, d]
  })
  return hit
}

/**
 * A tap while fixing rings. On a ring it removes it (a finger, a petal, a pen mark). On empty paper it adds a
 * ring for a tube the finder missed, sized like the median ring, as scripts/read-runs.ts places one. Rings
 * stay in reading order.
 */
export function tapRings(rings: Region[], x: number, y: number, reach: number): Region[] {
  // Sorted again either way: the finder's order was worked out with the removed ring in it.
  const i = ringAt(rings, x, y, reach)
  return readingOrder(i >= 0 ? rings.filter((_, j) => j !== i) : [...rings, discRegion(x, y, median(rings.map(radius)) || 12)])
}

/** Roles come only from the grower's two taps, never from position: a photo from the other side flips the row. */
export function rolesFrom(n: number, pc: number, nc: number): Role[] {
  if (pc === nc || pc < 0 || nc < 0 || pc >= n || nc >= n) throw new Error(`bad control taps ${pc}, ${nc} of ${n}`)
  return Array.from({ length: n }, (_, i) => (i === pc ? 'pc' : i === nc ? 'nc' : 'sample'))
}

/** Each ring's label: + and − for the controls, samples 1 to 8 in reading order. */
export const tubeNames = (roles: Role[]) => {
  let n = 0
  return roles.map((r) => (r === 'pc' ? '+' : r === 'nc' ? '−' : String(++n)))
}

export function readTubes(img: Img, rings: Region[], roles: Role[]): RunRead {
  const paper = globalPaper(img)
  return readCalibrated(
    rings.map((r) => measure(img, r, paper)),
    roles,
    MODEL,
    BAND,
  )
}
