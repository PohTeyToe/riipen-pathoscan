// The real photos: 27 CC0 colorimetric LAMP panels from Zenodo 4476336, with per-well roles and truth
// written by hand from the paper (data/real/labels.json; how in the README).

import { discRegion, globalPaper, measure } from './find'
import { readByGroup, readCalibrated, readMidpoint, readNaive, type Band, type Model } from './readers'
import type { Img, Role, Truth } from './synth'

export interface Well {
  id: string
  x: number
  y: number
  r: number
  role: 'sample' | 'ntc' | 'pc' | 'other'
  truth: Truth | 'unknown'
  basis: string
  paper_call: 'pos' | 'neg' | 'inconclusive' | null
  /** Radius of a white glare disc in the middle of the liquid; read the ring between hole_r and r. */
  hole_r?: number
  /** CV1-6 (Orf1a primers) or CV15-20 (N primers). Each assay on a plate has its own controls. */
  assay?: string
  sample?: string
  ct?: number
  /** The paper's own hue for this reaction, degrees. */
  paper_hue?: number
}

export interface RealImage {
  file: string
  figure: string
  width: number
  height: number
  what: string
  legend: string
  wells: Well[]
  notes?: string
}

export interface Labels {
  source: { zenodo: string; license: string; paper: string; retrieved: string }
  images: RealImage[]
  summary: { exclude_suggested: string[] }
}

/** Wells the reader reads: everything but wells whose content the paper doesn't document. */
export const readable = (img: RealImage) => img.wells.filter((w) => w.role !== 'other')
export const wellRole = (w: Well): Role => (w.role === 'ntc' ? 'nc' : w.role === 'other' ? 'sample' : w.role)
export const assayName = (w: Well) => (w.assay ? w.assay.replace(/ \(.*\)/, '') : '')

/** Photos left out of every score, with the reason shown on the page. */
export const EXCLUDED: Record<string, string> = {
  'LAMP10_SuppFig2_a.jpg': "Taken before incubation, so the colours show each sample's starting pH, not a LAMP result. Shown, not scored.",
}
export const realSrc = (file: string) => `/real/${file}`

/**
 * Read one labelled photo: each documented well as a disc (or a ring around a glare disc), each assay on the
 * plate against its own controls. The page and scripts/eval-real.ts both call this.
 */
export function readRealImage(img: Img, image: RealImage, p: { cut: number; model: Model; band: Band }) {
  const wells = readable(image)
  const paper = globalPaper(img)
  const regions = wells.map((w) => discRegion(w.x * img.width, w.y * img.height, w.r * img.width, w.hole_r ? w.hole_r * img.width : undefined))
  const feats = regions.map((r) => measure(img, r, paper))
  const roles = wells.map(wellRole)
  const groups = wells.map(assayName)
  const pick = <T,>(xs: T[], idx: number[]) => idx.map((i) => xs[i])
  return {
    wells,
    regions,
    feats,
    roles,
    groups,
    naive: readNaive(feats, p.cut),
    calibrated: readByGroup(groups, (idx) => readCalibrated(pick(feats, idx), pick(roles, idx), p.model, p.band)),
    midpoint: readByGroup(groups, (idx) => readMidpoint(pick(feats, idx), pick(roles, idx))),
  }
}
