// Small copies of the real photos for the page's photo picker: public/real/thumbs/, 240 px wide.
// Run with `npx tsx scripts/thumbs.ts` after changing public/real/.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { readImage } from './io'

const SRC = 'public/real'
const OUT = `${SRC}/thumbs`
const WIDTH = 240
mkdirSync(OUT, { recursive: true })
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.jpg'))) {
  const img = readImage(`${SRC}/${file}`)
  const k = img.width / WIDTH
  const w = WIDTH
  const h = Math.max(1, Math.round(img.height / k))
  const data = Buffer.alloc(w * h * 4)
  // Box filter: average every source pixel that falls inside each thumbnail pixel.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * k))
      const y0 = Math.floor(y * k)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k))
      const acc = [0, 0, 0]
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * img.width + sx) * 4
          acc[0] += img.data[o]
          acc[1] += img.data[o + 1]
          acc[2] += img.data[o + 2]
        }
      const n = (x1 - x0) * (y1 - y0)
      const o = (y * w + x) * 4
      data[o] = acc[0] / n
      data[o + 1] = acc[1] / n
      data[o + 2] = acc[2] / n
      data[o + 3] = 255
    }
  writeFileSync(`${OUT}/${file}`, jpeg.encode({ data, width: w, height: h }, 70).data)
}
console.log(`thumbnails written to ${OUT}`)
