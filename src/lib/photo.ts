// Browser-only helpers for photos: decode to pixels at a bounded size, and draw pixels to a canvas.

import type { Img } from './synth'

export const MAX_SIDE = 1400

export async function loadImage(src: string | Blob): Promise<Img> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const el = new Image()
    el.decoding = 'async'
    el.src = url
    await el.decode()
    const k = Math.min(1, MAX_SIDE / Math.max(el.naturalWidth, el.naturalHeight))
    const w = Math.max(1, Math.round(el.naturalWidth * k))
    const h = Math.max(1, Math.round(el.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(el, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    return { width: w, height: h, data }
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
}

export function draw(canvas: HTMLCanvasElement, img: Img) {
  if (canvas.width !== img.width) canvas.width = img.width
  if (canvas.height !== img.height) canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
}
