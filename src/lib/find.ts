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
  /** A found region's box in pixels. Unset for a placed disc, whose size the reader chose. */
  area?: number
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

const lumOf = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Under a fifth of the paper's light a pixel is dark: the table, a vignette, a deep shadow. */
const DARK = 0.2

/**
 * Median linear colour of the brightest third of the pixels in a box, from about this many samples, leaving
 * out any inside `skip`. Null if `skip` covers over three quarters of the box: too little left to judge.
 */
function whiteIn(img: Img, bx0: number, by0: number, bx1: number, by1: number, samples: number, skip?: Region): RGB | null {
  const { width: w, data } = img
  const x0 = Math.max(0, Math.floor(bx0))
  const y0 = Math.max(0, Math.floor(by0))
  const x1 = Math.min(w - 1, Math.ceil(bx1))
  const y1 = Math.min(img.height - 1, Math.ceil(by1))
  const stride = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / samples)))
  const out = (x: number, y: number) => !!skip && x >= skip.x0 && x <= skip.x1 && y >= skip.y0 && y <= skip.y1
  const lum = new Uint32Array(766)
  let n = 0
  let all = 0
  for (let y = y0; y <= y1; y += stride)
    for (let x = x0; x <= x1; x += stride) {
      all++
      if (out(x, y)) continue
      const o = (y * w + x) * 4
      lum[data[o] + data[o + 1] + data[o + 2]]++
      n++
    }
  if (n === 0 || n * 4 < all) return null
  let cut = 765
  for (let acc = 0; cut > 0; cut--) if ((acc += lum[cut]) * 3 >= n) break
  const hist = new Uint32Array(768)
  let m = 0
  for (let y = y0; y <= y1; y += stride)
    for (let x = x0; x <= x1; x += stride) {
      const o = (y * w + x) * 4
      if (out(x, y) || data[o] + data[o + 1] + data[o + 2] < cut) continue
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      m++
    }
  return histMedian(hist, m).map((v) => Math.max(1e-3, LIN8[v])) as RGB
}

/** The whole photo's white: the paper, or whatever white the photo has. */
export const globalPaper = (img: Img): RGB => whiteIn(img, 0, 0, img.width - 1, img.height - 1, 40000)!

/**
 * The paper's white around a point: the white of a box a quarter of the photo's long side across. Light is
 * rarely even (a lamp on one side warms the paper there), so each tube is judged against the paper near it.
 * The tube itself (`skip`) is left out, so a big one in a close-up can't become its own white. A box with
 * too little left, or too dark to hold paper (all table or shadow), takes the whole photo's white.
 */
function areaPaper(img: Img, x: number, y: number, paper: RGB, skip?: Region): RGB {
  const r = Math.max(img.width, img.height) / 8
  const c = whiteIn(img, x - r, y - r, x + r, y + r, 4000, skip)
  return !c || lumOf(c) < DARK * lumOf(paper) ? paper : c
}

/**
 * areaPaper on a grid of points an eighth of the long side apart, blended between the four nearest: the
 * finder's white at any pixel, written into `out` (the finder asks for it at every work pixel).
 */
function paperField(img: Img, paper: RGB): (x: number, y: number, out: RGB) => void {
  const step = Math.max(img.width, img.height) / 8
  const cols = Math.max(1, Math.round(img.width / step))
  const rows = Math.max(1, Math.round(img.height / step))
  const cw = img.width / cols
  const ch = img.height / rows
  const cells: RGB[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push(areaPaper(img, (i + 0.5) * cw, (j + 0.5) * ch, paper))
  return (x, y, out) => {
    const fx = Math.min(cols - 1, Math.max(0, x / cw - 0.5))
    const fy = Math.min(rows - 1, Math.max(0, y / ch - 0.5))
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const i1 = Math.min(cols - 1, i + 1)
    const j1 = Math.min(rows - 1, j + 1)
    const tx = fx - i
    const ty = fy - j
    const a = cells[j * cols + i]
    const b = cells[j * cols + i1]
    const c = cells[j1 * cols + i]
    const d = cells[j1 * cols + i1]
    for (let k = 0; k < 3; k++) out[k] = (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty
  }
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
  const white = paperField(img, paper)
  const p: RGB = [0, 0, 0]
  const f = Math.max(1, Math.max(img.width, img.height) / WORK)
  const w = Math.max(1, Math.floor(img.width / f))
  const h = Math.max(1, Math.floor(img.height / f))
  const mask = new Uint8Array(w * h)
  /** Each work pixel's light as a share of the paper's light there. */
  const lum = new Float32Array(w * h)
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
      white((x + 0.5) * f, (y + 0.5) * f, p)
      mask[y * w + x] = isLiquid(r / n, g / n, b / n, p) ? 1 : 0
      lum[y * w + x] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / lumOf(p)
    }
  }
  // The table: dark pixels joined to the frame. A pen mark or a dark cap out on the paper isn't table.
  const table = new Uint8Array(w * h)
  const todo: number[] = []
  const seed = (i: number) => {
    if (!table[i] && lum[i] < DARK) (table[i] = 1), todo.push(i)
  }
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x)
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1)
  while (todo.length) {
    const j = todo.pop()!
    const x = j % w
    if (x > 0) seed(j - 1)
    if (x < w - 1) seed(j + 1)
    if (j >= w) seed(j - w)
    if (j < (h - 1) * w) seed(j + w)
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

  // A tube's liquid sits on paper. A region with the frame or the dark table along one side is not a tube on
  // paper: a dark corner, the edge of the table, a tube cut off by the crop. None can be read. So each side
  // of a region is checked over a strip as deep as the region is narrow: a side is off the paper if the strip
  // lies outside the frame or more than half of it is table. Shaded or tinted paper beside a tube is still
  // paper. Drop these before joining: a border region's box can span most of the photo and would swallow tubes.
  const offPaper = (x0: number, x1: number, y0: number, y1: number) => {
    x0 = Math.max(0, x0)
    y0 = Math.max(0, y0)
    x1 = Math.min(w - 1, x1)
    y1 = Math.min(h - 1, y1)
    if (x1 < x0 || y1 < y0) return true
    let dark = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dark += table[y * w + x]
    return dark * 2 > (x1 - x0 + 1) * (y1 - y0 + 1)
  }
  const besideTable = (b: Box) => {
    const d = Math.max(2, Math.min(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1))
    return (
      offPaper(b.x0 - d, b.x0 - 1, b.y0, b.y1) ||
      offPaper(b.x1 + 1, b.x1 + d, b.y0, b.y1) ||
      offPaper(b.x0, b.x1, b.y0 - d, b.y0 - 1) ||
      offPaper(b.x0, b.x1, b.y1 + 1, b.y1 + d)
    )
  }
  const minArea = Math.max(4, w * h * 0.00004)
  let parts = boxes.filter((b) => b.n >= minArea && !besideTable(b))

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
 * Rows top to bottom, then left to right. It is one row if every centre sits close to one straight line (a
 * row of tubes photographed at a slant), or if the centres, taken left to right, never share a column and
 * never step up or down by more than one and a half regions' height (a row laid in a gentle curve; real
 * phone photos step up to about 1.3). Otherwise a new row starts where the centres jump down by more than
 * half a region's height. Known limit: rows offset by half a column and closer than 1.5 regions' height
 * (staggered wells) look like one wavy row and are read as one. Tubes in a rack sit far further apart, and
 * the page lets you set the controls or place tubes by hand.
 */
export function readingOrder(regions: Region[]): Region[] {
  if (regions.length === 0) return regions
  const hMed = median(regions.map((r) => r.y1 - r.y0 + 1))
  const byX = [...regions].sort((a, b) => a.cx - b.cx)
  if (regions.length >= 3) {
    const n = regions.length
    const mx = regions.reduce((a, r) => a + r.cx, 0) / n
    const my = regions.reduce((a, r) => a + r.cy, 0) / n
    const sxx = regions.reduce((a, r) => a + (r.cx - mx) ** 2, 0)
    const slope = sxx > 0 ? regions.reduce((a, r) => a + (r.cx - mx) * (r.cy - my), 0) / sxx : 0
    const onLine = regions.every((r) => Math.abs(r.cy - (my + slope * (r.cx - mx))) < 0.5 * hMed)
    // Staggered rows also zigzag left to right, but each step jumps a full row; aligned rows share columns.
    const wMed = median(regions.map((r) => r.x1 - r.x0 + 1))
    const chain = byX
      .slice(1)
      .every((r, i) => r.cx - byX[i].cx > 0.5 * wMed && Math.abs(r.cy - byX[i].cy) < 1.5 * hMed)
    if (Math.abs(slope) < 1 && (onLine || chain)) return byX
  }
  const byY = [...regions].sort((a, b) => a.cy - b.cy)
  const rows: Region[][] = [[byY[0]]]
  for (let i = 1; i < byY.length; i++) {
    if (byY[i].cy - byY[i - 1].cy > 0.5 * hMed) rows.push([byY[i]])
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

/**
 * Measure one region: its clear liquid colour, raw and paper-corrected. Liquid is told from paper against the
 * paper around the region (areaPaper), not the whole photo's `paper`, so paper warmed by a lamp on one side
 * isn't taken for liquid. The colour is then corrected by the paper right beside it.
 */
export function measure(img: Img, region: Region, paper: RGB): Features | null {
  const { width: w, height: h, data } = img
  const near = areaPaper(img, region.cx, region.cy, paper, region)
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
      if (!isLiquid(LIN8[data[o]], LIN8[data[o + 1]], LIN8[data[o + 2]], near)) {
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
    area: region.r === undefined ? area : undefined,
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
