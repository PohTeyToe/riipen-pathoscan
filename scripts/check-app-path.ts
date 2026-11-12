// Runs real photos through the field app's own Photo-screen code, in Chromium: the camera file is re-encoded
// to the saved JPEG, the saved JPEG is decoded and ringed, hand-placed points stand in for the grower's taps
// (removing rings on no tube, adding rings on missed tubes, then the two controls), and the run is read.
// Each sample is also read from a ring removed and added back by a tap, as a missed tube would be.
// Each photo is also turned 180 degrees at full size, as if taken from the other side, and run again.
//   npx tsx scripts/check-app-path.ts <manifest.json> [overlay-dir] > <out.json>
// The manifest is a list of photos:
//   [{ "id": "kit17", "photo": "path/to/camera.jpg", "pc": "+", "nc": "-",
//      "tubes": { "+": [x, y], "-": [x, y], "1": [x, y], ... } }]   // a point on each tube's liquid
// Points are in the app's image frame: the photo upright as the browser shows it, longest side 1400.
// The JSON goes to standard output. Real photos are a lab's data: keep the manifest, overlays and output
// outside this repo.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

interface Entry {
  id: string
  photo: string
  pc: string
  nc: string
  tubes: Record<string, [number, number]>
}

const [manifestPath, overlayDir] = process.argv.slice(2)
if (!manifestPath) throw new Error('usage: check-app-path.ts <manifest.json> [overlay-dir] > <out.json>')
const entries: Entry[] = JSON.parse(readFileSync(manifestPath, 'utf8'))

/** A 390 CSS pixel wide phone, the width the reach of a tap is judged at. */
const PHONE_PX = 390

const server = await createServer({ root: resolve(import.meta.dirname, '..'), logLevel: 'error', server: { port: 5132, strictPort: false } })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.addInitScript('globalThis.__name = (f) => f') // tsx names functions with a helper the page lacks
  await page.route('**/__check/photo/*', (route) => route.fulfill({ path: entries[Number(route.request().url().split('/').pop())].photo }))
  await page.goto(new URL('/app.html', server.resolvedUrls!.local[0]).href)

  const photos = []
  for (const [k, e] of entries.entries()) {
    const out = await page.evaluate(
      async ({ k, e, PHONE_PX, draw }) => {
        // The app's own modules, as Vite serves them to the page.
        const load = (path: string) => import(/* @vite-ignore */ path)
        const reader: typeof import('../src/app/reader') = await load('/src/app/reader.ts')
        const { encodePhoto }: typeof import('../src/app/camera') = await load('/src/app/camera.ts')
        const { loadImage }: typeof import('../src/lib/photo') = await load('/src/lib/photo.ts')
        const names = Object.keys(e.tubes)
        const camera = await (await fetch(`/__check/photo/${k}`)).blob()

        // The same scene from the other side: the camera's file turned 180 degrees at full size.
        const bitmap = await createImageBitmap(camera)
        const c = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = c.getContext('2d')!
        ctx.translate(bitmap.width, bitmap.height)
        ctx.rotate(Math.PI)
        ctx.drawImage(bitmap, 0, 0)
        const turned = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 })

        const run = async (file: Blob, flip: boolean) => {
          const img = await loadImage(await encodePhoto(file)) // the saved file, as the Photo screen reads it
          const pt = (n: string): [number, number] => {
            const [x, y] = e.tubes[n]
            return flip ? [img.width - 1 - x, img.height - 1 - y] : [x, y]
          }
          const reach = (reader.REACH_PX * img.width) / PHONE_PX
          let rings = reader.findRings(img)
          const found = rings.length
          const hits = () => names.map((n) => reader.ringAt(rings, ...pt(n), reach))
          let removed = 0
          let added = 0
          // Remove every ring that isn't on exactly one tube, one tap each.
          for (;;) {
            const h = hits()
            const bad = rings.findIndex((_, i) => h.filter((x) => x === i).length !== 1)
            if (bad < 0) break
            const before = rings.length
            rings = reader.tapRings(rings, rings[bad].cx, rings[bad].cy, reach)
            if (rings.length !== before - 1) return { error: `a tap on ring ${bad + 1} didn't remove it` }
            removed++
          }
          // Ring every tube the finder missed.
          for (const n of names)
            if (reader.ringAt(rings, ...pt(n), reach) < 0) {
              rings = reader.tapRings(rings, ...pt(n), reach)
              added++
            }
          const h = hits()
          if (rings.length !== names.length || new Set(h).size !== names.length || h.includes(-1)) return { error: 'taps did not give one ring per tube', found, removed, added }
          const roles = reader.rolesFrom(rings.length, h[names.indexOf(e.pc)], h[names.indexOf(e.nc)])
          const read = reader.readTubes(img, rings, roles)
          const label = reader.tubeNames(rings, roles)
          // Each sample's ring removed and added back by a tap on its point: the call a placed ring gives.
          const readded = (n: string) => {
            const ring = rings[h[names.indexOf(n)]]
            const rs = reader.tapRings(reader.tapRings(rings, ring.cx, ring.cy, reach), ...pt(n), reach)
            const at = (m: string) => reader.ringAt(rs, ...pt(m), reach)
            return reader.readTubes(img, rs, reader.rolesFrom(rs.length, at(e.pc), at(e.nc))).tubes[at(n)].call
          }
          let overlay: string | undefined
          if (draw) {
            const oc = new OffscreenCanvas(img.width, img.height)
            const o = oc.getContext('2d')!
            o.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
            o.lineWidth = 3
            o.font = `bold ${Math.round(img.width / 40)}px sans-serif`
            rings.forEach((r, i) => {
              o.strokeStyle = read.tubes[i].call === 'held' ? '#c00' : '#00f'
              o.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
              o.fillStyle = o.strokeStyle
              o.fillText(`${label[i]}${{ pos: '+', neg: '-', held: '?' }[read.tubes[i].call]}`, r.x0, r.y0 - 6)
            })
            const b = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
            overlay = btoa(Array.from(new Uint8Array(await b.arrayBuffer()), (x) => String.fromCharCode(x)).join(''))
          }
          return {
            size: [img.width, img.height],
            found,
            removed,
            added,
            status: read.status,
            flags: read.flags,
            held: names.filter((_, j) => roles[h[j]] === 'sample' && read.tubes[h[j]].call === 'held').length,
            tubes: names.map((n, j) => ({
              name: n,
              ring: h[j] + 1,
              appLabel: label[h[j]],
              placed: rings[h[j]].r !== undefined,
              call: read.tubes[h[j]].call,
              s: read.tubes[h[j]].s,
              p: read.tubes[h[j]].p,
              reason: read.tubes[h[j]].reason,
              readded: roles[h[j]] === 'sample' ? readded(n) : undefined,
            })),
            overlay,
          }
        }
        return { upright: await run(camera, false), turned: await run(turned, true) }
      },
      { k, e, PHONE_PX, draw: Boolean(overlayDir) },
    )
    for (const side of ['upright', 'turned'] as const) {
      const o = out[side] as { overlay?: string }
      if (overlayDir && o.overlay) writeFileSync(join(overlayDir, `${e.id}-${side}.jpg`), Buffer.from(o.overlay, 'base64'))
      delete o.overlay
    }
    const calls = (s: 'upright' | 'turned') => ('tubes' in out[s] ? out[s].tubes!.map((t) => t.call) : null)
    const same = JSON.stringify(calls('upright')) === JSON.stringify(calls('turned'))
    photos.push({ id: e.id, photo: e.photo, sameCallsTurned: calls('upright') !== null && same, ...out })
    console.error(`${e.id}: ${'error' in out.upright ? out.upright.error : `${out.upright.held} held`}, turned ${same ? 'same' : 'DIFFERENT'}`)
  }
  process.stdout.write(JSON.stringify({ photos }, null, 1) + '\n')
} finally {
  await browser.close()
  await server.close()
}
