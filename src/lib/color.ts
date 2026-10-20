// Colour maths shared by the renderer, the finder and both readers. Channels are 0..1 unless named 8-bit.

export type RGB = [number, number, number]

export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// Linear to sRGB through a table, for the per-pixel loops. Input past 1 clips.
export const SRGB_LUT = Float32Array.from({ length: 4096 }, (_, i) => toSrgb(i / 4095))
export const fastSrgb = (c: number) => SRGB_LUT[c >= 1 ? 4095 : c <= 0 ? 0 : (c * 4095) | 0]

// 8-bit sRGB to linear, as a lookup table: the hot loops call it per pixel.
export const LIN8 = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255))

/** HSV hue in degrees, signed so pinks sit below 0 (-180..180). Saturation and value 0..1. */
export function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h > 180) h -= 360
  if (h <= -180) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/** CIELAB (D65) from linear sRGB. */
export function linToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const fx = fLab(x)
  const fy = fLab(y)
  const fz = fLab(z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** Lab hue angle in degrees, signed like hsv(). */
export const labHue = (a: number, b: number) => (Math.atan2(b, a) * 180) / Math.PI

/**
 * The colour a white surface takes under a light of this colour temperature, in linear RGB, scaled so
 * 5500 K is neutral. Tanner Helland's blackbody fit; good enough to tint a scene, not for colorimetry.
 */
export function lightCast(kelvin: number): RGB {
  const raw = (k: number): RGB => {
    const t = k / 100
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
    const c = (v: number) => toLinear(Math.min(255, Math.max(0, v)) / 255)
    return [c(r), c(g), c(b)]
  }
  const k = raw(kelvin)
  const n = raw(5500)
  return [k[0] / n[0], k[1] / n[1], k[2] / n[2]]
}

export const median = (xs: number[]) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const css = (rgb: RGB) => `rgb(${rgb.map((c) => Math.round(c * 255)).join(' ')})`
