// Relights a photo the way the synthetic renderer lights a run: a colour cast (partly left in by the camera)
// and an exposure change, applied in linear light, then clipped like a sensor would.

import { fastSrgb, LIN8, lightCast } from './color'
import { CAST_LEFT, type Img } from './synth'

export function relight(img: Img, kelvin: number, ev: number): Img {
  if (Math.abs(kelvin - 5500) < 1 && Math.abs(ev) < 1e-3) return img
  const cast = lightCast(kelvin)
  const g = 2 ** ev
  const k = [cast[0] ** CAST_LEFT * g, cast[1] ** CAST_LEFT * g, cast[2] ** CAST_LEFT * g]
  const out = new Uint8ClampedArray(img.data.length)
  const lut = [0, 1, 2].map((c) => Uint8ClampedArray.from({ length: 256 }, (_, v) => fastSrgb(LIN8[v] * k[c]) * 255 + 0.5))
  const d = img.data
  for (let o = 0; o < d.length; o += 4) {
    out[o] = lut[0][d[o]]
    out[o + 1] = lut[1][d[o + 1]]
    out[o + 2] = lut[2][d[o + 2]]
    out[o + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}
