// Node-only image IO for the scripts. The site decodes images with the browser instead.
import { readFileSync, writeFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { Img } from '../src/lib/synth'

export function readImage(path: string): Img {
  const buf = readFileSync(path)
  if (/\.png$/i.test(path)) {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) }
  }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 2048, maxResolutionInMP: 200 })
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.length) }
}

export function writePng(img: Img, path: string) {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(path, PNG.sync.write(png))
}
