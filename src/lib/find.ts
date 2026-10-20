// Finds the coloured liquid in a photo of tubes or wells, and measures each one. Both readers get exactly
// the same regions and pixels from here; they differ only in how they turn a colour into a call.

import { fastSrgb, hsv, LIN8, linToLab, labHue, median, toSrgb, type RGB } from './color'
import type { Img } from './synth'

export interface Region {
  /** Bounding box and centre in full-resolution pixels. */
  x0: number
  y0: number
  x1: number
  y1: number
  cx: number
  cy: number
  /** Set for a placed or labelled disc: read the pixels within r of the centre instead of the colour mask. */
  r?: number
  /** Skip pixels closer to the centre than this (a glare disc sitting in the middle of a well). */
  r0?: number
}

export interface Features {
  /** Median 8-bit colour of the clear liquid pixels, as the camera saw it. */
  raw: RGB
  rawHue: number
  /** The same pixels divided by the nearby paper, as sRGB 0..1. */
  corrected: RGB
  lab: { L: number; a: number; b: number }
  labHue: number
  clear: number
  glare: number
  /** How the paper reference was found. */
  paperFrom: 'local' | 'global'
}

const WORK = 480

/** Per-channel median of 8-bit values, from 256-bin histograms (one per channel, laid end to end). */
function histMedian(hist: Uint32Array, n: number): RGB {
  const out: RGB = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[c * 256 + v]
      if (acc * 2 >= n) {
        out[c] = v
        break
      }
    }
  }
  return out
}

/** Median linear colour of the brightest third of the image: the paper, or whatever white the photo has. */
export function globalPaper(img: Img): RGB {
  const { width: w, height: h, data } = img
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)))
  const lum = new Uint32Array(766)
  let n = 0
  for (let y = 0; y < h; y += stride)
    for (let x = 0; x < w; x += stride) {
      const o = (y * w + x) * 4
      lum[data[o] + data[o + 1] + data[o + 2]]++
      n++
    }
  let cut = 765
  for (let acc = 0; cut > 0; cut--) if ((acc += lum[cut]) * 3 >= n) break
  const hist = new Uint32Array(768)
  let m = 0
  for (let y = 0; y < h; y += stride)
    for (let x = 0; x < w; x += stride) {
      const o = (y * w + x) * 4
      if (data[o] + data[o + 1] + data[o + 2] < cut) continue
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      m++
    }
  return histMedian(hist, m).map((v) => Math.max(1e-3, LIN8[v])) as RGB
}

// Inlined HSV: this runs on every pixel the finder and the measurer look at.
export function isLiquid(r: number, g: number, b: number, paper: RGB): boolean {
  const R = fastSrgb(r / paper[0])
  const G = fastSrgb(g / paper[1])
  const B = fastSrgb(b / paper[2])
  const max = R > G ? (R > B ? R : B) : G > B ? G : B
  if (max < 0.22) return false
  const min = R < G ? (R < B ? R : B) : G < B ? G : B
  const d = max - min
  if (d < 0.22 * max) return false
  // Warm hues only: red is the max channel (pink to orange), or green is with red close behind (yellow).
  if (max === R) return G >= B ? true : (B - G) / d <= 75 / 60
  if (max === G) return (B - R) / d + 2 <= 80 / 60
  return false
}

export function findRegions(img: Img): { regions: Region[]; paper: RGB } {
  const paper = globalPaper(img)
  const f = Math.max(1, Math.max(img.width, img.height) / WORK)
  const w = Math.max(1, Math.floor(img.width / f))
  const h = Math.max(1, Math.floor(img.height / f))
  const mask = new Uint8Array(w * h)
  // Box-average each work pixel's footprint, then test it.
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f)
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * f))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f)
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * f))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * img.width + sx) * 4
          r += LIN8[img.data[o]]
          g += LIN8[img.data[o + 1]]
          b += LIN8[img.data[o + 2]]
          n++
        }
      mask[y * w + x] = isLiquid(r / n, g / n, b / n, paper) ? 1 : 0
    }
  }

  // Connected components, 4-neighbour.
  const label = new Int32Array(w * h).fill(-1)
  type Box = { x0: number; y0: number; x1: number; y1: number; n: number; sx: number; sy: number }
  const boxes: Box[] = []
  const stack: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue
    const id = boxes.length
    const box: Box = { x0: w, y0: h, x1: 0, y1: 0, n: 0, sx: 0, sy: 0 }
    label[i] = id
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      const x = j % w
      const y = (j - x) / w
      box.n++
      box.sx += x
      box.sy += y
      if (x < box.x0) box.x0 = x
      if (x > box.x1) box.x1 = x
      if (y < box.y0) box.y0 = y
      if (y > box.y1) box.y1 = y
      if (x > 0 && mask[j - 1] && label[j - 1] < 0) (label[j - 1] = id), stack.push(j - 1)
      if (x < w - 1 && mask[j + 1] && label[j + 1] < 0) (label[j + 1] = id), stack.push(j + 1)
      if (y > 0 && mask[j - w] && label[j - w] < 0) (label[j - w] = id), stack.push(j - w)
      if (y < h - 1 && mask[j + w] && label[j + w] < 0) (label[j + w] = id), stack.push(j + w)
    }
    boxes.push(box)
  }

  const minArea = Math.max(4, w * h * 0.00004)
  let parts = boxes.filter((b) => b.n >= minArea)

  // A glare streak or a bubble can cut one liquid region in two. Join parts that nearly touch.
  const parent = parts.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const size = (b: Box) => Math.min(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1)
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]
      const b = parts[j]
      const k = 0.3 * Math.min(size(a), size(b)) + 1
      const gx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)
      const gy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)
      if (gx <= k && gy <= k) parent[find(i)] = find(j)
    }
  const merged = new Map<number, Box>()
  parts.forEach((b, i) => {
    const r = find(i)
    const m = merged.get(r)
    if (!m) merged.set(r, { ...b })
    else {
      m.x0 = Math.min(m.x0, b.x0)
      m.y0 = Math.min(m.y0, b.y0)
      m.x1 = Math.max(m.x1, b.x1)
      m.y1 = Math.max(m.y1, b.y1)
      m.n += b.n
      m.sx += b.sx
      m.sy += b.sy
    }
  })
  parts = [...merged.values()]
  const medArea = median(parts.map((b) => b.n))
  parts = parts.filter((b) => b.n >= 0.12 * medArea)

  const regions: Region[] = parts.map((b) => ({
    x0: Math.floor(b.x0 * f),
    y0: Math.floor(b.y0 * f),
    x1: Math.min(img.width - 1, Math.ceil((b.x1 + 1) * f) - 1),
    y1: Math.min(img.height - 1, Math.ceil((b.y1 + 1) * f) - 1),
    cx: (b.sx / b.n + 0.5) * f,
    cy: (b.sy / b.n + 0.5) * f,
  }))
  return { regions: readingOrder(regions), paper }
}

/**
 * Rows top to bottom, then left to right. A new row starts where the centres jump down by more than most of
 * a region's height, so a slightly slanted line of tubes stays one row while plate rows split.
 */
export function readingOrder(regions: Region[]): Region[] {
  if (regions.length === 0) return regions
  const hMed = median(regions.map((r) => r.y1 - r.y0 + 1))
  const byY = [...regions].sort((a, b) => a.cy - b.cy)
  const rows: Region[][] = [[byY[0]]]
  for (let i = 1; i < byY.length; i++) {
    if (byY[i].cy - byY[i - 1].cy > 0.8 * hMed) rows.push([byY[i]])
    else rows[rows.length - 1].push(byY[i])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.cx - b.cx))
}

export const discRegion = (cx: number, cy: number, r: number, r0?: number): Region => ({
  x0: Math.floor(cx - r),
  y0: Math.floor(cy - r),
  x1: Math.ceil(cx + r),
  y1: Math.ceil(cy + r),
  cx,
  cy,
  r,
  r0,
})

/** Measure one region: its clear liquid colour, raw and paper-corrected. */
export function measure(img: Img, region: Region, paper: RGB): Features | null {
  const { width: w, height: h, data } = img
  const hist = new Uint32Array(768)
  let n = 0
  let glare = 0
  const x0 = Math.max(0, region.x0)
  const y0 = Math.max(0, region.y0)
  const x1 = Math.min(w - 1, region.x1)
  const y1 = Math.min(h - 1, region.y1)
  const area = (x1 - x0 + 1) * (y1 - y0 + 1)
  const step = Math.max(1, Math.floor(Math.sqrt(area / 6000)))
  for (let y = y0; y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) {
      if (region.r !== undefined) {
        const d2 = (x - region.cx) ** 2 + (y - region.cy) ** 2
        if (d2 > region.r ** 2 || (region.r0 && d2 < region.r0 ** 2)) continue
      }
      const o = (y * w + x) * 4
      if (!isLiquid(LIN8[data[o]], LIN8[data[o + 1]], LIN8[data[o + 2]], paper)) {
        // Inside a placed disc, a washed-out pixel is glare, a bubble or a reflection. In a found region
        // it is just the background around the liquid.
        if (region.r !== undefined) glare++
        continue
      }
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      n++
    }
  if (n === 0) return null
  // Per-channel medians. The linear median is the linear value of the 8-bit median, since the curve is
  // monotonic, so one set of histograms serves both.
  const raw = histMedian(hist, n)
  const rawHsv = hsv(raw[0] / 255, raw[1] / 255, raw[2] / 255)
  const local = localPaper(img, region, paper)
  const ref = local ?? paper
  const cl = raw.map((v, i) => Math.min(1.2, LIN8[v] / ref[i])) as RGB
  const lab = linToLab(cl[0], cl[1], cl[2])
  return {
    raw,
    rawHue: rawHsv.h,
    corrected: cl.map((c) => toSrgb(c)) as RGB,
    lab,
    labHue: labHue(lab.a, lab.b),
    clear: n * step * step,
    glare: glare * step * step,
    paperFrom: local ? 'local' : 'global',
  }
}

/** Median of the pale, neutral pixels in a ring around the region: the paper right next to the liquid. */
function localPaper(img: Img, region: Region, paper: RGB): RGB | null {
  const { width: w, height: h, data } = img
  const half = Math.max(region.x1 - region.x0, region.y1 - region.y0) / 2 + 1
  const rIn = half * 1.25
  const rOut = half * 2.2
  const step = Math.max(1, Math.floor(rOut / 40))
  const paperL = paper[0] + paper[1] + paper[2]
  const hist = new Uint32Array(768)
  let n = 0
  for (let y = Math.max(0, Math.floor(region.cy - rOut)); y < Math.min(h, region.cy + rOut); y += step)
    for (let x = Math.max(0, Math.floor(region.cx - rOut)); x < Math.min(w, region.cx + rOut); x += step) {
      const d2 = (x - region.cx) ** 2 + (y - region.cy) ** 2
      if (d2 < rIn * rIn || d2 > rOut * rOut) continue
      const o = (y * w + x) * 4
      const r = LIN8[data[o]]
      const g = LIN8[data[o + 1]]
      const b = LIN8[data[o + 2]]
      if (r + g + b < 0.45 * paperL) continue
      const R = fastSrgb(r / paper[0])
      const G = fastSrgb(g / paper[1])
      const B = fastSrgb(b / paper[2])
      const max = Math.max(R, G, B)
      if (max - Math.min(R, G, B) >= 0.12 * max) continue
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      n++
    }
  if (n < 20) return null
  return histMedian(hist, n).map((v) => Math.max(1e-3, LIN8[v])) as RGB
}
