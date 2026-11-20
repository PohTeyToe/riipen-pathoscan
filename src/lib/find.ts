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
  /** The same pixels divided by the paper's white, as sRGB 0..1. */
  corrected: RGB
  lab: { L: number; a: number; b: number }
  labHue: number
  /**
   * The lowest and highest Lab hue the tube could have under the whites the paper around it allows. Close
   * to labHue in even light; wide where the light changes across the tube in a way the white can't follow.
   */
  hueRange: [number, number]
  /**
   * True when the camera clipped a channel of the liquid or of a white its colour or its range is read
   * against: the liquid, the ring's paper, a side of the ring the range uses, the white map at the tube, or
   * the whole photo's white where the range uses it (see isClipped). A clipped channel held at least the
   * light it shows and maybe far more, so the colour has no bound.
   */
  clipped: boolean
  clear: number
  glare: number
  /** A found region's box in pixels. Unset for a placed disc, whose size the reader chose. */
  area?: number
  /** True when paper beside the tube set the white; false when only the white map did. */
  paperBeside: boolean
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

/*
 * Clipping. A camera that runs out of range in a channel records all the light past it as one top value, and
 * a phone's tone curve, applied after, may move that value below 255 but keeps those pixels together. So
 * clipped light piles up on one 8-bit value per channel, the photo's brightest, with next to nothing above
 * it. A colour or a white taken as a median of a set of pixels is wrong once about half of them sit in that
 * pile. A heuristic, checked on synthetic photos and the public real ones, not a measured phone-JPEG boundary.
 */

/**
 * Below this no pile is taken for clipped light. A tone curve or edit that takes a third of a stop off the
 * highlights moves 255 to 230, and a JPEG spreads that by SPREAD. One that takes more is out of this check's
 * reach: evenly lit paper makes humps as sharp as a pile not far below this. Bright paper above it is told
 * from a pile by RISE.
 */
const PILE_FLOOR = 228

/**
 * How much taller a pile is than the values just below its spread. Where the light runs past the top over a
 * large area, the pile is tens of times taller; where a lamp's gradient runs into it, about six times. The
 * narrow hump of evenly lit paper with nothing above it is about three times taller.
 */
const RISE = 4

/**
 * How far a JPEG spreads a pile, in 8-bit values either way. Where one or two channels clip and the others
 * don't, the JPEG's coarser colour detail smears the clipped channel over about two values either side.
 */
const SPREAD = 2

/**
 * The 8-bit value the photo's clipped light piles up on, per channel: of the values at PILE_FLOOR or more that
 * are a pile, the one with the most pixels within SPREAD of it; 255 if none is. A pile
 * - is the highest count within SPREAD, and RISE times each of the two counts just below that;
 * - has under a twentieth as many pixels above it, past SPREAD, as within SPREAD of it, as light piled at the
 *   top can't have much above it, only the little a JPEG rings past;
 * - holds at least 1 pixel in 10,000 within SPREAD of it.
 * The most pixels, since a JPEG's ringing past a lowered pile, clamped at 255, can make a small pile there.
 */
function clipLevel(img: Img): RGB {
  const { data } = img
  const n = img.width * img.height
  const hist = new Uint32Array(768)
  for (let o = 0; o < data.length; o += 4) {
    hist[data[o]]++
    hist[256 + data[o + 1]]++
    hist[512 + data[o + 2]]++
  }
  return [0, 1, 2].map((c) => {
    const h = hist.subarray(c * 256, c * 256 + 256)
    const at = (v: number) => (v < 256 ? h[v] : 0)
    let level = 255
    let most = 0
    let above = 0
    for (let v = 255; v >= PILE_FLOOR; v--) {
      above += at(v + SPREAD + 1)
      let near = 0
      let peak = true
      for (let u = v - SPREAD; u <= v + SPREAD; u++) {
        near += at(u)
        peak &&= at(u) <= h[v]
      }
      peak &&= h[v] >= RISE * Math.max(h[v - SPREAD - 1], h[v - SPREAD - 2])
      if (peak && above * 20 < near && near * 10000 >= n && near > most) [level, most] = [v, near]
    }
    return level
  }) as RGB
}

/**
 * The share of a set of pixels on the photo's clip level, or one above it (a JPEG's ringing past a lowered
 * pile), at which the set counts as clipped. A median moves once half the set clips. Noise or a JPEG moves
 * part of a clipped patch below the level, where bright paper that didn't clip sits too, so those aren't
 * counted: synthetic noise leaves half of a clipped patch on the level, a JPEG of a flat patch nearly all of
 * it. A quarter on the level flags a set about half clipped in the noisiest photos, and sooner in clean ones.
 */
const CLIP_SHARE = 0.25

/** Per channel, the share of a set of pixels (8-bit histograms laid end to end) on the clip level or one above. */
function onLevel(hist: Uint32Array, n: number, level: RGB): RGB {
  return level.map((v, c) => (n > 0 ? (hist[c * 256 + v] + (v < 255 ? hist[c * 256 + v + 1] : 0)) / n : 0)) as RGB
}

/**
 * The one clip test: a set of pixels is clipped if CLIP_SHARE of it is on the clip level in any channel
 * (onLevel). Every set a colour or a white is taken from goes through it.
 */
const isClipped = (share: RGB) => share.some((s) => s >= CLIP_SHARE)

/** A white, and its pixels' share on the clip level (onLevel). */
interface White {
  white: RGB
  onLevel: RGB
}

/** Median linear colour of the brightest third of the pixels in a box, from about this many samples. */
function whiteIn(img: Img, bx0: number, by0: number, bx1: number, by1: number, samples: number, level: RGB): White {
  const { width: w, data } = img
  const x0 = Math.max(0, Math.floor(bx0))
  const y0 = Math.max(0, Math.floor(by0))
  const x1 = Math.min(w - 1, Math.ceil(bx1))
  const y1 = Math.min(img.height - 1, Math.ceil(by1))
  const stride = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / samples)))
  const lum = new Uint32Array(766)
  let n = 0
  for (let y = y0; y <= y1; y += stride)
    for (let x = x0; x <= x1; x += stride) {
      const o = (y * w + x) * 4
      lum[data[o] + data[o + 1] + data[o + 2]]++
      n++
    }
  let cut = 765
  for (let acc = 0; cut > 0; cut--) if ((acc += lum[cut]) * 3 >= n) break
  const hist = new Uint32Array(768)
  let m = 0
  for (let y = y0; y <= y1; y += stride)
    for (let x = x0; x <= x1; x += stride) {
      const o = (y * w + x) * 4
      if (data[o] + data[o + 1] + data[o + 2] < cut) continue
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      m++
    }
  return { white: histMedian(hist, m).map((v) => Math.max(1e-3, LIN8[v])) as RGB, onLevel: onLevel(hist, m, level) }
}

/**
 * The paper's white around a point: the white of a box a quarter of the photo's long side across. Light is
 * rarely even (a lamp on one side warms the paper there), so each tube is judged against the paper near it.
 * A box too dark to hold paper (all table or shadow) takes the whole photo's white.
 */
function areaPaper(img: Img, x: number, y: number, paper: White, level: RGB): White {
  const r = Math.max(img.width, img.height) / 8
  const c = whiteIn(img, x - r, y - r, x + r, y + r, 4000, level)
  return lumOf(c.white) < DARK * lumOf(paper.white) ? paper : c
}

/** The white at a pixel, written into `out` (the finder asks for it at every work pixel). */
type Field = (x: number, y: number, out: RGB) => void

/** A photo's light, worked out once per photo. */
interface Light {
  /** clipLevel. */
  level: RGB
  /** The whole photo's white: the paper, or whatever white the photo has. */
  paper: White
  /** The white map (paperField). */
  field: Field
  /**
   * The share on the clip level of the pixels the map's white at a pixel comes from: the cells' shares,
   * blended as their whites are.
   */
  onLevelAt: Field
}
const lights = new WeakMap<Img, Light>()

/** The whole photo's white: the paper, or whatever white the photo has. */
export const globalPaper = (img: Img): RGB => lightOf(img).paper.white

function lightOf(img: Img): Light {
  let light = lights.get(img)
  if (!light) {
    const level = clipLevel(img)
    const paper = whiteIn(img, 0, 0, img.width - 1, img.height - 1, 40000, level)
    light = { level, paper, ...paperField(img, paper, level) }
    lights.set(img, light)
  }
  return light
}

/** areaPaper on a grid of points an eighth of the long side apart, blended between the four nearest. */
function paperField(img: Img, paper: White, level: RGB): Pick<Light, 'field' | 'onLevelAt'> {
  const step = Math.max(img.width, img.height) / 8
  const cols = Math.max(1, Math.round(img.width / step))
  const rows = Math.max(1, Math.round(img.height / step))
  const cw = img.width / cols
  const ch = img.height / rows
  const centre = (k: number) => [((k % cols) + 0.5) * cw, (Math.floor(k / cols) + 0.5) * ch]
  const rough = Array.from({ length: rows * cols }, (_, k) => areaPaper(img, ...(centre(k) as [number, number]), paper, level))
  const blend = blendOf(
    rough.map((c) => c.white),
    cols,
    rows,
    cw,
    ch,
  )
  // A box's brightest third sits on its less-lit side when the light changes across it, so the first cells
  // run cool beside a warm lamp. Second pass: each cell's box taken against that first field, pixel by pixel,
  // which flattens the change, and the white at the centre from the brightest third of those shares.
  const r = step
  const f: RGB = [0, 0, 0]
  const shares = new Float32Array(3 * 4 * 1000)
  const offsets = new Uint32Array(4 * 1000)
  const lumHist = new Uint32Array(SHARE_BINS)
  const hist = new Uint32Array(3 * SHARE_BINS)
  const hist8 = new Uint32Array(768)
  const cells = rough.map((c, k): White => {
    if (c === paper) return c // too dark to hold paper: the whole photo's white
    const [cx, cy] = centre(k)
    const x0 = Math.max(0, Math.floor(cx - r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const x1 = Math.min(img.width - 1, Math.ceil(cx + r))
    const y1 = Math.min(img.height - 1, Math.ceil(cy + r))
    const stride = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 1000)))
    lumHist.fill(0)
    hist.fill(0)
    hist8.fill(0)
    let n = 0
    for (let y = y0; y <= y1; y += stride)
      for (let x = x0; x <= x1 && n < shares.length / 3; x += stride) {
        const o = (y * img.width + x) * 4
        blend(x, y, f)
        offsets[n] = o
        const s = 3 * n++
        shares[s] = LIN8[img.data[o]] / f[0]
        shares[s + 1] = LIN8[img.data[o + 1]] / f[1]
        shares[s + 2] = LIN8[img.data[o + 2]] / f[2]
        lumHist[shareBin(0.2126 * shares[s] + 0.7152 * shares[s + 1] + 0.0722 * shares[s + 2])]++
      }
    let cut = SHARE_BINS - 1
    for (let acc = 0; cut > 0; cut--) if ((acc += lumHist[cut]) * 3 >= n) break
    let m = 0
    for (let s = 0; s < 3 * n; s += 3) {
      if (shareBin(0.2126 * shares[s] + 0.7152 * shares[s + 1] + 0.0722 * shares[s + 2]) < cut) continue
      for (let ch = 0; ch < 3; ch++) {
        hist[ch * SHARE_BINS + shareBin(shares[s + ch])]++
        hist8[ch * 256 + img.data[offsets[s / 3] + ch]]++
      }
      m++
    }
    blend(cx, cy, f)
    return { white: f.map((v, ch) => Math.max(1e-3, v * shareMedian(hist, ch, m))) as RGB, onLevel: onLevel(hist8, m, level) }
  })
  return {
    field: blendOf(
      cells.map((c) => c.white),
      cols,
      rows,
      cw,
      ch,
    ),
    onLevelAt: blendOf(
      cells.map((c) => c.onLevel),
      cols,
      rows,
      cw,
      ch,
    ),
  }
}

/** Shares of a white (near 1) binned in steps of 1/512 from 0 to 2, so their medians need no sort. */
const SHARE_BINS = 1024
const shareBin = (v: number) => (v >= 2 ? SHARE_BINS - 1 : v > 0 ? Math.floor(v * 512) : 0)
function shareMedian(hist: Uint32Array, ch: number, n: number): number {
  for (let i = 0, acc = 0; i < SHARE_BINS; i++) if ((acc += hist[ch * SHARE_BINS + i]) * 2 >= n) return (i + 0.5) / 512
  return 2
}

/**
 * A white at any pixel from whites on a grid of cell centres, blended between the four nearest. Between the
 * outer centres and the frame the light keeps changing the way it does between the last two (a lamp just
 * past the edge), so the blend carries on past them instead of holding flat.
 */
function blendOf(cells: RGB[], cols: number, rows: number, cw: number, ch: number): Field {
  return (x, y, out) => {
    const fx = Math.min(cols - 0.5, Math.max(-0.5, x / cw - 0.5))
    const fy = Math.min(rows - 0.5, Math.max(-0.5, y / ch - 0.5))
    const i = Math.min(Math.max(0, cols - 2), Math.max(0, Math.floor(fx)))
    const j = Math.min(Math.max(0, rows - 2), Math.max(0, Math.floor(fy)))
    const i1 = Math.min(cols - 1, i + 1)
    const j1 = Math.min(rows - 1, j + 1)
    const tx = i1 > i ? fx - i : 0
    const ty = j1 > j ? fy - j : 0
    const a = cells[j * cols + i]
    const b = cells[j * cols + i1]
    const c = cells[j1 * cols + i]
    const d = cells[j1 * cols + i1]
    for (let k = 0; k < 3; k++) out[k] = Math.max(1e-3, (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty)
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

export function findRegions(img: Img): { regions: Region[] } {
  const white = lightOf(img).field
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
  return { regions: readingOrder(regions) }
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
 * Measure one region: its clear liquid colour, raw and corrected by the paper's white.
 *
 * One white: the white map (the finder's), set right by the paper around the tube. Each pixel is taken
 * against the map's white where it sits, so liquid is told from paper as the finder tells it, and light that
 * changes across the tube is divided out pixel by pixel. The map is smooth and can be off at a tube, so the
 * paper in a ring around it says by how much: the median of the ring's paper against the map. That sets the
 * colour, not which pixels are liquid: a tube can tint the paper or plastic around it with its own colour,
 * and a pale tube judged against that tint shows no colour at all. Where the ring isn't enough, the hue is
 * uncertain, and `hueRange` spans the hues the tube could have:
 * - under each side's white (left, right, above, below), which disagree where the light changes in a way
 *   the map doesn't follow;
 * - under the ring's paper as it is, one white for the whole tube, which disagrees where a tube that fills
 *   much of the photo has tinted the map;
 * - with paper on fewer than two sides, under the whole photo's white, since one side can't show how the
 *   light changes across the tube.
 * With no paper in the ring, the map alone gives the white. In even light these all agree. If the liquid or
 * any of these whites comes from clipped pixels, the tube is marked clipped.
 */
export function measure(img: Img, region: Region): Features | null {
  const { width: w, height: h, data } = img
  const light = lightOf(img)
  const { field, level } = light
  const paper = light.paper.white
  // Paper is told by being neutral against the white, so where the map is well off, paper doesn't pass as
  // paper. A second look against the map set right by the first finds it.
  const first = ringPaper(img, region, field, paper, [1, 1, 1], level)
  const ring = first && (ringPaper(img, region, field, paper, first.all, level) ?? first)
  const k = ring?.all ?? [1, 1, 1]
  const at: RGB = [0, 0, 0]
  /** The most of the map's white at any liquid pixel that comes from the clip level, per channel. */
  const mapOn: RGB = [0, 0, 0]
  const on: RGB = [0, 0, 0]
  const hist = new Uint32Array(768)
  const shares = new Uint32Array(3 * SHARE_BINS)
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
      const r = LIN8[data[o]]
      const g = LIN8[data[o + 1]]
      const b = LIN8[data[o + 2]]
      field(x, y, at)
      if (!isLiquid(r, g, b, at)) {
        // Inside a placed disc, a washed-out pixel is glare, a bubble or a reflection. In a found region
        // it is just the background around the liquid.
        if (region.r !== undefined) glare++
        continue
      }
      hist[data[o]]++
      hist[256 + data[o + 1]]++
      hist[512 + data[o + 2]]++
      shares[shareBin(r / at[0])]++
      shares[SHARE_BINS + shareBin(g / at[1])]++
      shares[2 * SHARE_BINS + shareBin(b / at[2])]++
      light.onLevelAt(x, y, on)
      for (let c = 0; c < 3; c++) if (on[c] > mapOn[c]) mapOn[c] = on[c]
      n++
    }
  if (n === 0) return null
  // Per-channel medians. The linear median is the linear value of the 8-bit median, since the curve is
  // monotonic, so one set of histograms serves both.
  const raw = histMedian(hist, n)
  const rawHsv = hsv(raw[0] / 255, raw[1] / 255, raw[2] / 255)
  const toLab = (cl: RGB) => {
    const lab = linToLab(cl[0], cl[1], cl[2])
    return { cl, lab, hue: labHue(lab.a, lab.b) }
  }
  const liquid = [0, 1, 2].map((c) => shareMedian(shares, c, n))
  /** The liquid's colour under the map's white at the tube times c. */
  const under = (c: RGB) => toLab(liquid.map((v, i) => Math.min(1.2, v / c[i])) as RGB)
  /** The liquid's colour under one white for the whole tube. */
  const against = (white: RGB) => toLab(raw.map((v, i) => Math.min(1.2, LIN8[v] / white[i])) as RGB)
  const best = under(k)
  const hues = [best.hue]
  if (ring) hues.push(...ring.sides.map((s) => under(s).hue), against(ring.paper).hue)
  const wholePhoto = !ring || ring.sides.length < 2
  if (wholePhoto) hues.push(against(paper).hue)
  // Every set of pixels the colour and its range come from: the liquid, the map at it, the ring's paper and
  // each side of it the range uses, and the whole photo's white where the range uses it.
  const clipped = isClipped(onLevel(hist, n, level)) || isClipped(mapOn) || !!ring?.clipped || (wholePhoto && isClipped(light.paper.onLevel))
  return {
    raw,
    rawHue: rawHsv.h,
    corrected: best.cl.map((c) => toSrgb(c)) as RGB,
    lab: best.lab,
    labHue: best.hue,
    hueRange: [Math.min(...hues), Math.max(...hues)],
    clipped,
    clear: n * step * step,
    glare: glare * step * step,
    area: region.r === undefined ? area : undefined,
    paperBeside: !!ring,
  }
}

/**
 * The paper around a region: pale pixels in a ring around it that are neutral against the map's white
 * where they sit (set right by k), or against the whole photo's white (a plate's grey plastic, where the map
 * leans towards the wells' colour). Its median colour; its median share of the map, for the whole ring and
 * for each side of it with enough paper to judge; and whether the ring or one of those sides is clipped.
 * Null with too little paper in the ring.
 */
function ringPaper(img: Img, region: Region, field: Field, paper: RGB, k: RGB, level: RGB): { paper: RGB; all: RGB; sides: RGB[]; clipped: boolean } | null {
  const { width: w, height: h, data } = img
  // A band around the region, from a quarter to 1.2 times half its short side out: around a disc, the ring
  // from 1.25 to 2.2 radii; around a tall tube's liquid, the paper right beside it.
  const half = Math.min(region.x1 - region.x0, region.y1 - region.y0) / 2 + 1
  const dIn = 0.25 * half
  const dOut = 1.2 * half
  const step = Math.max(1, Math.floor((Math.max(region.x1 - region.x0, region.y1 - region.y0) + 2 * dOut) / 80))
  const paperL = paper[0] + paper[1] + paper[2]
  const f: RGB = [0, 0, 0]
  // Six sets of histograms: the whole ring's colour, then its share of the map for the whole ring, right,
  // below, left and above.
  const hist = new Uint32Array(6 * 3 * SHARE_BINS)
  // Each set's 8-bit pixels, for onLevel. Set 1 holds set 0's pixels.
  const hist8 = new Uint32Array(6 * 768)
  const count = [0, 0, 0, 0, 0, 0]
  const add = (set: number, r: number, g: number, b: number, px: number) => {
    const o = set * 3 * SHARE_BINS
    hist[o + shareBin(r)]++
    hist[o + SHARE_BINS + shareBin(g)]++
    hist[o + 2 * SHARE_BINS + shareBin(b)]++
    hist8[set * 768 + data[px]]++
    hist8[set * 768 + 256 + data[px + 1]]++
    hist8[set * 768 + 512 + data[px + 2]]++
    count[set]++
  }
  for (let y = Math.max(0, Math.floor(region.y0 - dOut)); y <= Math.min(h - 1, region.y1 + dOut); y += step)
    for (let x = Math.max(0, Math.floor(region.x0 - dOut)); x <= Math.min(w - 1, region.x1 + dOut); x += step) {
      // How far out of a found region's box, across and down, signed by the side; or past a disc's rim.
      const dx = x < region.x0 ? x - region.x0 : x > region.x1 ? x - region.x1 : 0
      const dy = y < region.y0 ? y - region.y0 : y > region.y1 ? y - region.y1 : 0
      const d = region.r === undefined ? Math.hypot(dx, dy) : Math.hypot(x - region.cx, y - region.cy) - region.r
      if (d < dIn || d > dOut) continue
      const o = (y * w + x) * 4
      const R = LIN8[data[o]]
      const G = LIN8[data[o + 1]]
      const B = LIN8[data[o + 2]]
      if (R + G + B < 0.45 * paperL) continue
      field(x, y, f)
      const r = R / f[0]
      const g = G / f[1]
      const b = B / f[2]
      if (r + g + b < 0.45 * 3 || !(neutral(r / k[0], g / k[1], b / k[2]) || neutral(R / paper[0], G / paper[1], B / paper[2]))) continue
      add(0, R, G, B, o)
      add(1, r, g, b, o)
      const sx = dx || x - region.cx
      const sy = dy || y - region.cy
      add(Math.abs(sx) >= Math.abs(sy) ? (sx > 0 ? 2 : 4) : sy > 0 ? 3 : 5, r, g, b, o)
    }
  if (count[0] < 20) return null
  const median = (set: number) => [0, 1, 2].map((c) => Math.max(1e-3, shareMedian(hist.subarray(set * 3 * SHARE_BINS), c, count[set]))) as RGB
  const sides = [2, 3, 4, 5].filter((s) => count[s] >= 8)
  const clipped = [0, ...sides].some((s) => isClipped(onLevel(hist8.subarray(s * 768, (s + 1) * 768), count[s], level)))
  return { paper: median(0), all: median(1), sides: sides.map(median), clipped }
}

/** A colour, as a share of a white, with under an eighth as much chroma as brightness. */
function neutral(r: number, g: number, b: number): boolean {
  const R = fastSrgb(r)
  const G = fastSrgb(g)
  const B = fastSrgb(b)
  const max = Math.max(R, G, B)
  return max - Math.min(R, G, B) < 0.12 * max
}
