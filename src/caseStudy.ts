// PathoScan's greenhouse case-study photo (PDF p. 4), as measured by scripts/case-study-check.ts. The photo isn't in
// the repo; data/case-study.json holds the reads. Hue is HSV hue as the camera saw it: 0 is red, 60 is yellow.

import cs from '../data/case-study.json'

export interface CaseRow {
  tube: string
  rawHue: number
  hand: 'pos' | 'neg' | 'control'
}

export const CASE_URL = cs.url
export const rows = cs.centrePlacementRadius4.filter((r) => 'tube' in r) as CaseRow[]
/** Every read was repeated at this many placements of the read spots. */
export const PLACEMENTS = Object.values(cs.over27Placements.naiveAgreesWithHandOf8).reduce((a, b) => a + b, 0)
const hue = (t: string) => rows.find((r) => r.tube === t)!.rawHue
export const PC = hue('PC')
export const NC = hue('NC')
/** Where a midpoint rule puts its cut: halfway between the controls' hues. */
export const MID = (PC + NC) / 2

/** How many placements had the midpoint rule disagree with the handwritten call on this tube. */
export function flips(tube: string) {
  let n = 0
  for (const [set, count] of Object.entries(cs.over27Placements.midpointDisagreesWithHand)) if (set.split('+').includes(tube)) n += count
  return n
}

export const posTubes = rows.filter((r) => r.hand === 'pos')
/** Placements at which the positive control read less yellow than every tube marked +. */
export const allPosPastPc: number = (cs.over27Placements.positivesMoreYellowThanPC as Record<string, number>)[String(posTubes.length)] ?? 0
/** Placements at which the fixed cut matched all eight handwritten calls. */
export const naiveAllEight: number = (cs.over27Placements.naiveAgreesWithHandOf8 as Record<string, number>)['8'] ?? 0
/** Tubes marked − that the midpoint rule calls positive at every placement. */
export const always = rows.filter((r) => r.hand === 'neg' && flips(r.tube) === PLACEMENTS).map((r) => r.tube.replace('PS', ''))
