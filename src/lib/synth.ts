// Synthetic PathoKit-style runs: a positive control, a negative control and 8 samples standing on white
// paper, drawn pixel by pixel from a small optical model. Everything here is made up on purpose and
// labelled synthetic wherever it shows. The point is known ground truth under controlled lighting.

import { lightCast, SRGB_LUT, type RGB } from './color'
import { rng, type Rng } from './rng'

export type Truth = 'pos' | 'neg'
export type Role = 'pc' | 'nc' | 'sample'
/** What the tube's chemistry did, which is not always what its truth is. */
export type Kind = 'control' | 'yellow' | 'orange' | 'unchanged' | 'clear-neg' | 'acidic'

export interface TubeSpec {
  role: Role
  truth: Truth
  kind: Kind
  /** Share of the indicator in its acid (yellow) form, 0 = pink, 1 = yellow. */
  t: number
  /** Fill height, 1 = a normal 25 µL-ish volume, 0.3 = low volume. */
  fill: number
  bubble: boolean
  /** Specular streak strength, 0 = none. */
  glare: number
  dx: number
}

export interface RunSpec {
  seed: number
  scenario: ScenarioId
  tubes: TubeSpec[]
  kelvin: number
  ev: number
  drift: number
  shadow: number
  shadowDir: number
  noise: number
  paper: RGB
}

export type Img = { width: number; height: number; data: Uint8ClampedArray }

export const SCENARIOS = [
  { id: 'typical', label: 'Typical run' },
  { id: 'weak-pc', label: 'Weak positive control' },
  { id: 'acidic', label: 'Acidic extract' },
  { id: 'glare', label: 'Glare' },
  { id: 'bubble', label: 'Bubble in sample 4' },
  { id: 'low-volume', label: 'Low volume' },
] as const
export type ScenarioId = (typeof SCENARIOS)[number]['id']

/**
 * How samples behave. My assumptions, partly anchored on PMC8079700 (RT-LAMP, phenol red): of PCR
 * positives, 79% read yellow, 14.5% orange and 6.5% stayed pink. Negatives that turn orange stand in for
 * acidic extracts or carry-over; that rate is a guess.
 */
export const PRIOR = { pPos: 0.4, posYellow: 0.79, posOrange: 0.145, negAcidic: 0.08 }

function sampleTube(r: Rng): TubeSpec {
  const base = { role: 'sample' as Role, fill: 1, bubble: false, glare: 0, dx: 0 }
  if (r() < PRIOR.pPos) {
    const u = r()
    if (u < PRIOR.posYellow) return { ...base, truth: 'pos', kind: 'yellow', t: r.uniform(0.72, 1) }
    if (u < PRIOR.posYellow + PRIOR.posOrange) return { ...base, truth: 'pos', kind: 'orange', t: r.uniform(0.38, 0.68) }
    return { ...base, truth: 'pos', kind: 'unchanged', t: r.uniform(0.02, 0.25) }
  }
  if (r() < PRIOR.negAcidic) return { ...base, truth: 'neg', kind: 'acidic', t: r.uniform(0.3, 0.6) }
  return { ...base, truth: 'neg', kind: 'clear-neg', t: r.uniform(0, 0.16) }
}

/** What the sliders pin. Anything left out is drawn at random per run. */
export interface Conditions {
  kelvin?: number
  ev?: number
  drift?: number
}

/**
 * A shift in starting pH shared by every tube in a run (master-mix lot, extraction buffer), as a share of
 * the way to yellow (positive) or to pink (negative). The controls shift with it, which is the point of
 * reading against them. The range is my assumption, not measured.
 */
export const DRIFT_RANGE = [-0.2, 0.2] as const

export function shiftedT(t: number, drift: number) {
  return drift >= 0 ? t + drift * (1 - t) : t * (1 + drift)
}

export function makeRun(seed: number, scenario: ScenarioId = 'typical', cond: Conditions = {}): RunSpec {
  const r = rng(seed)
  const pc: TubeSpec = { role: 'pc', truth: 'pos', kind: 'control', t: r.uniform(0.85, 1), fill: 1, bubble: false, glare: 0, dx: 0 }
  const nc: TubeSpec = { role: 'nc', truth: 'neg', kind: 'control', t: r.uniform(0, 0.08), fill: 1, bubble: false, glare: 0, dx: 0 }
  const tubes = [pc, nc, ...Array.from({ length: 8 }, () => sampleTube(r))]
  for (const tube of tubes) {
    tube.dx = r.uniform(-5, 5)
    tube.fill = r() < 0.08 ? r.uniform(0.28, 0.42) : r.uniform(0.7, 1)
    tube.glare = r() < 0.15 ? r.uniform(0.25, 0.7) : 0
    tube.bubble = r() < 0.05
  }
  const samples = tubes.slice(2)
  const pick = (n: number, from: TubeSpec[]) => r.shuffle([...from]).slice(0, n)
  switch (scenario) {
    case 'weak-pc':
      pc.t = r.uniform(0.42, 0.52)
      break
    case 'acidic': {
      const negs = samples.filter((t) => t.truth === 'neg')
      for (const t of pick(Math.min(2, negs.length), negs)) Object.assign(t, { kind: 'acidic', t: r.uniform(0.42, 0.6) })
      break
    }
    case 'glare':
      for (const t of pick(4, tubes)) t.glare = r.uniform(0.85, 1.1)
      break
    case 'bubble':
      samples[3].bubble = true
      break
    case 'low-volume':
      for (const t of pick(3, samples)) t.fill = r.uniform(0.26, 0.34)
      break
  }
  return {
    seed,
    scenario,
    tubes,
    kelvin: cond.kelvin ?? r.uniform(2700, 6500),
    ev: cond.ev ?? r.uniform(-1, 1),
    drift: cond.drift ?? r.uniform(DRIFT_RANGE[0], DRIFT_RANGE[1]),
    shadow: r.uniform(0, 0.35),
    shadowDir: r.uniform(0, Math.PI * 2),
    noise: r.uniform(0.006, 0.02),
    paper: [r.uniform(0.86, 0.92), r.uniform(0.86, 0.91), r.uniform(0.83, 0.89)],
  }
}

// Scene geometry, in scene units. A render at scale s is W*s by H*s pixels.
export const W = 1000
export const H = 420
const PITCH = 96
const X0 = 68
const CAP = [30, 62] as const
const BODY_END = 280
const TIP = 372

export const tubeX = (spec: RunSpec, i: number) => X0 + i * PITCH + spec.tubes[i].dx

function halfWidth(y: number): number {
  if (y < CAP[0] || y > TIP + 5) return -1
  if (y < CAP[1]) return 30
  if (y < BODY_END) return 26 - (2 * (y - CAP[1])) / (BODY_END - CAP[1])
  if (y <= TIP) return 24 - (19 * (y - BODY_END)) / (TIP - BODY_END)
  return 5 * Math.sqrt(1 - ((y - TIP) / 5) ** 2)
}

const fillTop = (fill: number) => TIP - fill * 140

/** Where the liquid sits in scene units, for matching found regions to tubes. */
export function liquidCentre(spec: RunSpec, i: number) {
  const top = fillTop(spec.tubes[i].fill)
  return { x: tubeX(spec, i), y: (top + TIP) / 2 }
}

// Absorbance per unit depth of phenol red's two forms in linear RGB. The base form absorbs green and some
// blue (pink); the acid form absorbs blue (yellow). Tuned by eye so mid mixes read orange.
const A_BASE: RGB = [0.05, 1.3, 0.9]
const A_ACID: RGB = [0.02, 0.18, 1.35]

/** Share of a light's colour cast left in the photo after the camera's auto white balance. */
export const CAST_LEFT = 0.65

// Paper grain on a 2-unit grid, and a pool of camera noise (sum of two uniforms, centred). Tables, because
// the per-pixel loop is the hot path of the eval.
const TEX_W = W / 2
const TEX = (() => {
  const r = rng(424242)
  return Float32Array.from({ length: TEX_W * (H / 2) }, () => 1 + (r() - 0.5) * 0.025)
})()
const NOISE_N = 1 << 16
const NOISE = (() => {
  const r = rng(99991)
  return Float32Array.from({ length: NOISE_N }, () => (r() + r() - 1) * 1.7)
})()

/** Draw one run. Scale 1 gives 1000x420 pixels; the live batch uses smaller scales. */
export function render(spec: RunSpec, scale = 1): Img {
  const w = Math.round(W * scale)
  const h = Math.round(H * scale)
  const data = new Uint8ClampedArray(w * h * 4)
  const cast = lightCast(spec.kelvin)
  const gain = 2 ** spec.ev
  // A phone's auto white balance takes out part of a cast; CAST_LEFT is the share it leaves in.
  const lit: RGB = [cast[0] ** CAST_LEFT * gain, cast[1] ** CAST_LEFT * gain, cast[2] ** CAST_LEFT * gain]
  let nIdx = (spec.seed * 7919) & (NOISE_N - 1)
  const nStep = 1 + 2 * (spec.seed % 97)
  const sdx = Math.cos(spec.shadowDir)
  const sdy = Math.sin(spec.shadowDir)
  const xs = spec.tubes.map((_, i) => tubeX(spec, i))
  const absorb = spec.tubes.map((tube): RGB => {
    const t = shiftedT(tube.t, spec.drift)
    return [0, 1, 2].map((c) => t * A_ACID[c] + (1 - t) * A_BASE[c]) as RGB
  })
  const px: RGB = [0, 0, 0]

  for (let py = 0; py < h; py++) {
    const y = (py + 0.5) / scale
    for (let qx = 0; qx < w; qx++) {
      const x = (qx + 0.5) / scale
      const tex = TEX[Math.min(H / 2 - 1, y >> 1) * TEX_W + Math.min(TEX_W - 1, x >> 1)]
      px[0] = spec.paper[0] * tex
      px[1] = spec.paper[1] * tex
      px[2] = spec.paper[2] * tex
      let spec_ = 0
      // Which tube column, if any.
      const i = Math.round((x - X0) / PITCH)
      if (i >= 0 && i < xs.length) {
        const tube = spec.tubes[i]
        const hw = halfWidth(y)
        const off = x - xs[i]
        if (hw > 0 && Math.abs(off) < hw) {
          const edge = Math.abs(off) > hw - 2.5
          if (y < CAP[1]) {
            const k = edge || Math.abs(y - CAP[1] + 6) < 1.5 ? 0.7 : 0.86
            px[0] *= k
            px[1] *= k
            px[2] *= k * 1.02
          } else {
            const top = fillTop(tube.fill) + 2 * (off / hw) ** 2
            let wall = edge ? 0.72 : 0.92
            if (y > top) {
              const depth = 0.75 + (0.7 * hw) / 26
              let inBubble = false
              if (tube.bubble) {
                const by = top + 0.45 * (TIP - top)
                const br = Math.min(hw * 0.6, (TIP - top) * 0.3)
                const d = Math.hypot(off + hw * 0.1, y - by)
                if (d < br) {
                  inBubble = true
                  wall = d > br - 2 ? 0.7 : 0.95
                }
              }
              if (!inBubble) {
                const a = absorb[i]
                px[0] *= Math.exp(-depth * a[0])
                px[1] *= Math.exp(-depth * a[1])
                px[2] *= Math.exp(-depth * a[2])
                if (Math.abs(y - top) < 1.2) wall *= 0.85
              }
            }
            px[0] *= wall
            px[1] *= wall
            px[2] *= wall * 1.02
            if (tube.glare > 0) {
              const gx = (off + hw * 0.4) / (hw * 0.2)
              if (Math.abs(gx) < 1) spec_ = tube.glare * (1 - gx * gx)
            }
          }
        }
      }
      const proj = ((x / W - 0.5) * sdx + (y / H - 0.5) * sdy) * 1.2 + 0.5
      const shade = 1 - spec.shadow * Math.min(1, Math.max(0, proj))
      const o = (py * w + qx) * 4
      for (let c = 0; c < 3; c++) {
        const lin = (px[c] * shade + spec_) * lit[c]
        const v = SRGB_LUT[lin >= 1 ? 4095 : (lin * 4095) | 0] + NOISE[(nIdx = (nIdx + nStep) & (NOISE_N - 1))] * spec.noise
        data[o + c] = v * 255 + 0.5
      }
      data[o + 3] = 255
    }
  }
  return { width: w, height: h, data }
}
