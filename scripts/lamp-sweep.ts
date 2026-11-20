// Synthetic runs under a lamp at one side of the photo, read through the field app's own photo path in
// Chromium: the camera PNG, the saved JPEG, the rings, the grower's taps (a missed tube tapped back, a stray
// ring removed), then the read. Each run is also read in even light. Per light it counts wrong calls, the
// tubes the lamp turned wrong that even light read right or held (the lamp's own harm: none is the bar),
// held tubes and failed runs.
//   npx tsx scripts/lamp-sweep.ts [--seeds 0-199] [--lamps 3000,2400,10000] [--root <checkout>] [--json <out.json>]
// --lamps takes colour temperatures, or 0 for a plain shade (15% darker at one side, no colour): what any
// small change to a photo does to tubes on the edge of a call, to weigh the lamps against. --root reads with
// another checkout's src and data (a release, say); the default is this one.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const [first, last] = (arg('seeds') ?? '0-199').split('-').map(Number)
const root = resolve(arg('root') ?? resolve(import.meta.dirname, '..'))
const jsonOut = arg('json')

type Layout = 'row' | '2x5'
type From = 'left' | 'right' | 'top'
interface Job {
  seed: number
  layout: Layout
  lamp: { kelvin: number; from: From } | null
}
interface Read {
  error?: string
  status?: string
  flags?: string[]
  calls?: string[]
  p?: (number | undefined)[]
  pRange?: ([number, number] | undefined)[]
  truth?: string[]
  roles?: string[]
  kinds?: string[]
}

const LAYOUTS: Layout[] = ['row', '2x5']
const LAMPS = (arg('lamps') ?? '3000,2400,10000').split(',').map(Number).flatMap((kelvin) => (['left', 'right', 'top'] as From[]).map((from) => ({ kelvin, from })))
const jobs: Job[] = []
for (let seed = first; seed <= (last ?? first); seed++)
  for (const layout of LAYOUTS) for (const lamp of [null, ...LAMPS]) jobs.push({ seed, layout, lamp })

// Plain transforms, no app config: only the reader's modules are loaded.
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { port: 5133, strictPort: false } })
await server.listen()
const base = server.resolvedUrls!.local[0]
const browser = await chromium.launch()
const results = new Map<string, Read>()
const key = (j: Job) => `${j.seed} ${j.layout} ${j.lamp ? `${j.lamp.kelvin} ${j.lamp.from}` : 'even'}`
const t0 = Date.now()

/** One page: builds the photo, runs the app's photo path, taps like a grower, reads. */
async function worker(queue: Job[]) {
  const page = await (await browser.newContext()).newPage()
  await page.addInitScript('globalThis.__name = (f) => f') // tsx names functions with a helper the page lacks
  await page.route('**/__sweep.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>sweep</title>' }))
  await page.goto(new URL('/__sweep.html', base).href)
  for (let job = queue.shift(); job; job = queue.shift()) {
    const read: Read = await page.evaluate(async ({ seed, layout, lamp }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const reader: typeof import('../src/app/reader') = await load('/src/app/reader.ts')
      const { encodePhoto }: typeof import('../src/app/camera') = await load('/src/app/camera.ts')
      const { loadImage }: typeof import('../src/lib/photo') = await load('/src/lib/photo.ts')
      const { liquidCentre, makeRun, render }: typeof import('../src/lib/synth') = await load('/src/lib/synth.ts')
      const { LIN8, lightCast, toSrgb }: typeof import('../src/lib/color') = await load('/src/lib/color.ts')

      // The run as e2e/app.e2e.ts draws it: a row, or the left five tubes above the right five.
      const run = makeRun(seed)
      const src = render(run, 1)
      const [W, H] = [src.width, src.height]
      const [w, h] = layout === 'row' ? [W, H] : [W / 2, 2 * H]
      const from = (x: number, y: number) => (layout === 'row' || y < H ? [x, y] : [x + W / 2, y - H])
      const to = ([x, y]: [number, number]): [number, number] => (layout === 'row' || x < W / 2 ? [x, y] : [x - W / 2, y + H])
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [sx, sy] = from(x, y)
          data.set(src.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * w + x) * 4)
        }
      // The lamp's colour at its side of the photo, fading to daylight at the far side.
      if (lamp) {
        const [lit, day] = [lightCast(lamp.kelvin), lightCast(6500)]
        const gain = lamp.kelvin ? lit.map((v, c) => v / day[c]) : [0.85, 0.85, 0.85]
        const top = lamp.kelvin ? Math.max(...gain) : 1
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const t = lamp.from === 'left' ? x / (w - 1) : lamp.from === 'right' ? 1 - x / (w - 1) : y / (h - 1)
            for (let c = 0; c < 3; c++) {
              const o = (y * w + x) * 4 + c
              const g = gain[c] / top
              data[o] = Math.round(toSrgb(LIN8[data[o]] * (g + (1 - g) * t)) * 255)
            }
          }
      }
      const canvas = new OffscreenCanvas(w, h)
      canvas.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0)
      const camera = await canvas.convertToBlob({ type: 'image/png' })
      const img = await loadImage(await encodePhoto(camera))
      const pts = run.tubes.map((_, i) => to([liquidCentre(run, i).x, liquidCentre(run, i).y]))

      // The grower's taps, as scripts/check-app-path.ts makes them.
      const reach = (reader.REACH_PX * img.width) / 390
      let rings = reader.findRings(img)
      const hits = () => pts.map((p) => reader.ringAt(rings, ...p, reach))
      for (;;) {
        const hit = hits()
        const bad = rings.findIndex((_, i) => hit.filter((x) => x === i).length !== 1)
        if (bad < 0) break
        const before = rings.length
        rings = reader.tapRings(rings, rings[bad].cx, rings[bad].cy, reach)
        if (rings.length !== before - 1) return { error: 'a tap did not remove a ring' }
      }
      for (const p of pts) if (reader.ringAt(rings, ...p, reach) < 0) rings = reader.tapRings(rings, ...p, reach)
      const order = pts.reduce<number[]>((o, p) => reader.tapInOrder(o, reader.ringAt(rings, ...p, reach)), [])
      if (rings.length !== pts.length || order.includes(-1)) return { error: 'taps did not give one ring per tube' }
      const r = reader.readTubes(img, order.map((i) => rings[i]), reader.ROLES)
      return {
        status: r.status,
        flags: r.flags,
        calls: r.tubes.map((t) => t.call),
        p: r.tubes.map((t) => t.p),
        pRange: r.tubes.map((t) => (t as { pRange?: [number, number] }).pRange), // unset on a reader without ranges
        truth: run.tubes.map((t) => t.truth),
        roles: run.tubes.map((t) => t.role),
        kinds: run.tubes.map((t) => t.kind),
      }
    }, job)
    results.set(key(job), read)
    if (results.size % 100 === 0 || results.size === 8) console.error(`${results.size} of ${jobs.length} read, ${Math.round((Date.now() - t0) / 1000)} s`)
  }
}

try {
  const queue = [...jobs]
  await Promise.all(Array.from({ length: 8 }, () => worker(queue)))
} finally {
  await browser.close()
  await server.close()
}

// Per light: wrong calls, flips against even light, held samples, failed runs, unread runs.
const wrongAt = (r: Read, i: number) => r.roles![i] === 'sample' && r.calls![i] !== 'held' && r.calls![i] !== r.truth![i]
const rows: Record<string, { samples: number; wrong: number; flips: number; held: number; failed: number; errors: number }> = {}
const flips: { run: string; tube: number; kind: string; even: string; lamp: string; p?: number }[] = []
for (const job of jobs) {
  const light = job.lamp ? `${job.lamp.kelvin} K ${job.lamp.from}` : 'even'
  const row = (rows[`${job.layout} ${light}`] ??= { samples: 0, wrong: 0, flips: 0, held: 0, failed: 0, errors: 0 })
  const r = results.get(key(job))!
  if (r.error) {
    row.errors++
    continue
  }
  const even = results.get(key({ ...job, lamp: null }))!
  if (r.status === 'failed') row.failed++
  r.roles!.forEach((role, i) => {
    if (role !== 'sample') return
    row.samples++
    if (r.calls![i] === 'held') row.held++
    if (!wrongAt(r, i)) return
    row.wrong++
    if (job.lamp && !even.error && !wrongAt(even, i)) {
      row.flips++
      flips.push({ run: key(job), tube: i - 1, kind: r.kinds![i], even: even.calls![i], lamp: r.calls![i], p: r.p![i] })
    }
  })
}
const total = (pick: (k: string) => boolean) =>
  Object.entries(rows)
    .filter(([k]) => pick(k))
    .reduce((a, [, r]) => ({ samples: a.samples + r.samples, wrong: a.wrong + r.wrong, flips: a.flips + r.flips, held: a.held + r.held }), { samples: 0, wrong: 0, flips: 0, held: 0 })
console.error(`root ${root}, seeds ${first}-${last ?? first}, ${Math.round((Date.now() - t0) / 1000)} s`)
console.error('light                  samples  wrong  flips  held%  failed  unread')
for (const [k, r] of Object.entries(rows))
  console.error(`${k.padEnd(22)} ${String(r.samples).padStart(7)} ${String(r.wrong).padStart(6)} ${String(r.flips).padStart(6)} ${((100 * r.held) / Math.max(1, r.samples)).toFixed(1).padStart(6)} ${String(r.failed).padStart(7)} ${String(r.errors).padStart(7)}`)
const lit = total((k) => !k.endsWith('even'))
const even = total((k) => k.endsWith('even'))
console.error(`even light: ${even.wrong} wrong, ${((100 * even.held) / even.samples).toFixed(1)}% held; under lamps: ${lit.wrong} wrong, ${lit.flips} flips (${flips.filter((f) => f.even !== 'held').length} read right in even light, the rest held), ${((100 * lit.held) / lit.samples).toFixed(1)}% held`)
for (const f of flips) console.error(JSON.stringify(f))
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ root, seeds: [first, last], rows, flips, reads: Object.fromEntries(results) }) + '\n')
