// Synthetic runs under a lamp at one side of the photo, a cast over the whole of it, or exposed brighter or
// darker, read through the field app's own photo path in Chromium: the camera PNG, the saved JPEG, the rings,
// the grower's taps (a missed tube tapped back, a stray ring removed), then the read. Each run is also read in
// even light at its own exposure. Per change it counts wrong calls, the tubes the change turned wrong that
// even light read right or held (the change's own harm: none is the bar), held tubes and failed runs.
//   npx tsx scripts/lamp-sweep.ts [--seeds 0-199,732] [--lamps 3000,2400,10000,0] [--ev -1,0.5,1,1.5]
//     [--casts 10000,2400] [--mixed 0.5,1] [--darken 0.1,0.3] [--darken-mixed 0.1] [--root <checkout>] [--workers 4]
//     [--json <out.json>] [--vs <other.json>]
// --lamps takes colour temperatures, or 0 for a plain shade (15% darker at one side, no colour), each from the
// left, the right and the top. --ev takes exposure steps in stops. --casts takes colour temperatures that
// light the whole scene, read at the run's own exposure and at each --mixed step. --mixed takes the steps at
// which every lamp and cast is also read. --darken takes stops by which the photo is darkened after the camera
// clipped it (a phone's tone mapping), each read at the run's own exposure and at every brighter --ev step;
// --darken-mixed, those read on every lamp and cast at every --mixed step. An empty list reads none. Lamps and
// casts light the scene before the camera clips, as real ones do (synth.ts photograph). --root reads with
// another checkout's reader (a release, say); the photos always come from this checkout, so two roots read
// the same pixels. --vs counts the tubes this read calls wrong that another sweep's JSON (same jobs) read
// right or held.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const list = (s: string) => s.split(',').filter(Boolean).map(Number)
const seeds = (arg('seeds') ?? '0-199').split(',').flatMap((part) => {
  const [a, b] = part.split('-').map(Number)
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
})
const here = resolve(import.meta.dirname, '..')
const root = resolve(arg('root') ?? here)
const jsonOut = arg('json')
const vsPath = arg('vs')

type Layout = 'row' | '2x5'
type From = 'left' | 'right' | 'top'
interface Job {
  seed: number
  layout: Layout
  lamp: { kelvin: number; from: From } | null
  /** A colour temperature for the light over the whole scene, in place of the run's own. */
  cast: number | null
  /** Stops added to the run's own exposure. */
  ev: number
  /** Stops the photo is darkened by after the camera clipped it. */
  darken: number
}
interface Read {
  error?: string
  status?: string
  flags?: string[]
  calls?: string[]
  reasons?: string[]
  p?: (number | undefined)[]
  pRange?: ([number, number] | undefined)[]
  truth?: string[]
  roles?: string[]
  kinds?: string[]
  /** The run's own exposure, before the job's step. */
  ev?: number
}

const LAYOUTS: Layout[] = ['row', '2x5']
const LAMPS = list(arg('lamps') ?? '3000,2400,10000,0').flatMap((kelvin) => (['left', 'right', 'top'] as From[]).map((from) => ({ kelvin, from })))
const EVS = list(arg('ev') ?? '-1,0.5,1,1.5')
const CASTS = list(arg('casts') ?? '10000,2400')
const MIXED = list(arg('mixed') ?? '0.5,1')
const DARKEN = list(arg('darken') ?? '0.1,0.3')
const DARKEN_MIXED = list(arg('darken-mixed') ?? '0.1')
const jobs: Job[] = []
for (const seed of seeds)
  for (const layout of LAYOUTS) {
    const job = (lamp: Job['lamp'], cast: number | null, ev: number, darken = 0) => jobs.push({ seed, layout, lamp, cast, ev, darken })
    job(null, null, 0)
    for (const ev of EVS) job(null, null, ev)
    for (const ev of [0, ...MIXED]) {
      for (const lamp of LAMPS) job(lamp, null, ev)
      for (const cast of CASTS) job(null, cast, ev)
    }
    for (const d of DARKEN) for (const ev of [0, ...EVS.filter((e) => e > 0)]) job(null, null, ev, d)
    for (const d of DARKEN_MIXED)
      for (const ev of MIXED) {
        for (const lamp of LAMPS) job(lamp, null, ev, d)
        for (const cast of CASTS) job(null, cast, ev, d)
      }
  }

/** The change from even light at the run's own exposure. */
const change = (j: Job) =>
  [
    j.cast && `${j.cast} K cast`,
    j.lamp && (j.lamp.kelvin ? `${j.lamp.kelvin} K ${j.lamp.from}` : `shade ${j.lamp.from}`),
    j.ev && `${j.ev > 0 ? '+' : ''}${j.ev} EV`,
    j.darken && `darkened ${j.darken}`,
  ]
    .filter(Boolean)
    .join(', ') || 'even'
const key = (j: Job) => `${j.seed} ${j.layout} ${change(j)}`
/** A change's family, for the totals: lamp, shade, cast, exposure, or a lamp, shade or cast with a step, each maybe darkened. */
const family = (j: Job) =>
  ((j.lamp ? (j.lamp.kelvin ? 'lamp' : 'shade') : j.cast ? 'cast' : '') + (j.ev ? (j.lamp || j.cast ? ' + EV' : 'EV') : '') || (j.darken ? 'own EV' : 'even')) +
  (j.darken ? ', darkened' : '')

// Plain transforms, no app config: only the reader's modules are loaded, from the root, and the photo's,
// from this checkout.
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { port: 5133, strictPort: false, fs: { strict: false } } })
await server.listen()
const base = server.resolvedUrls!.local[0]
const synthUrl = `/@fs/${resolve(here, 'src/lib/synth.ts').replaceAll('\\', '/')}`
const browser = await chromium.launch()
const results = new Map<string, Read>()
const t0 = Date.now()

/** One page: builds the photo, runs the app's photo path, taps like a grower, reads. */
async function worker(queue: Job[]) {
  const page = await (await browser.newContext()).newPage()
  await page.addInitScript('globalThis.__name = (f) => f') // tsx names functions with a helper the page lacks
  await page.route('**/__sweep.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>sweep</title>' }))
  await page.goto(new URL('/__sweep.html', base).href)
  for (let job = queue.shift(); job; job = queue.shift()) {
    const read: Read = await page.evaluate(
      async ({ job: { seed, layout, lamp, cast, ev, darken }, synthUrl }) => {
        const load = (path: string) => import(/* @vite-ignore */ path)
        const reader: typeof import('../src/app/reader') = await load('/src/app/reader.ts')
        const { encodePhoto }: typeof import('../src/app/camera') = await load('/src/app/camera.ts')
        const { loadImage }: typeof import('../src/lib/photo') = await load('/src/lib/photo.ts')
        const synth: typeof import('../src/lib/synth') = await load(synthUrl)

        const run = synth.makeRun(seed)
        const own = run.ev
        run.ev += ev
        if (cast) run.kelvin = cast
        const shot = synth.photograph(run, layout, lamp ?? undefined)
        const [photo, pts] = [darken ? synth.darken(shot.img, darken) : shot.img, shot.tubes]
        const canvas = new OffscreenCanvas(photo.width, photo.height)
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(photo.data), photo.width, photo.height), 0, 0)
        const img = await loadImage(await encodePhoto(await canvas.convertToBlob({ type: 'image/png' })))

        // The grower's taps, as scripts/check-app-path.ts makes them.
        const reach = (reader.REACH_PX * img.width) / 390
        let rings = reader.findRings(img)
        const hits = () => pts.map((p) => reader.ringAt(rings, ...p, reach))
        for (;;) {
          const hit = hits()
          const bad = rings.findIndex((_, i) => hit.filter((x) => x === i).length !== 1)
          if (bad < 0) break
          const before = rings.length
          rings = reader.tapRings(rings, rings[bad].cx, rings[bad].cy, img.width, img.width / 390)
          if (rings.length !== before - 1) return { error: 'a tap did not remove a ring' }
        }
        for (const p of pts) if (reader.ringAt(rings, ...p, reach) < 0) rings = reader.tapRings(rings, ...p, img.width, img.width / 390)
        const order = pts.reduce<number[]>((o, p) => reader.tapInOrder(o, reader.ringAt(rings, ...p, reach)), [])
        if (rings.length !== pts.length || order.includes(-1)) return { error: 'taps did not give one ring per tube' }
        const r = reader.readTubes(img, order.map((i) => rings[i]), reader.ROLES)
        return {
          status: r.status,
          flags: r.flags,
          calls: r.tubes.map((t) => t.call),
          reasons: r.tubes.map((t) => t.reason),
          p: r.tubes.map((t) => t.p),
          pRange: r.tubes.map((t) => (t as { pRange?: [number, number] }).pRange), // unset on a reader without ranges
          truth: run.tubes.map((t) => t.truth),
          roles: run.tubes.map((t) => t.role),
          kinds: run.tubes.map((t) => t.kind),
          ev: own,
        }
      },
      { job, synthUrl },
    )
    results.set(key(job), read)
    if (results.size % 500 === 0 || results.size === 8) console.error(`${results.size} of ${jobs.length} read, ${Math.round((Date.now() - t0) / 1000)} s`)
  }
}

try {
  const queue = [...jobs]
  await Promise.all(Array.from({ length: Number(arg('workers') ?? 4) }, () => worker(queue)))
} finally {
  await browser.close()
  await server.close()
}

const wrongAt = (r: Read, i: number) => r.roles![i] === 'sample' && r.calls![i] !== 'held' && r.calls![i] !== r.truth![i]
const vs: Record<string, Read> | undefined = vsPath && JSON.parse(readFileSync(vsPath, 'utf8')).reads
type Row = { samples: number; wrong: number; flips: number; newly: number; held: number; failed: number; errors: number }
const blank = (): Row => ({ samples: 0, wrong: 0, flips: 0, newly: 0, held: 0, failed: 0, errors: 0 })
const rows: Record<string, Row> = {}
const families: Record<string, Row> = {}
/** Even light by the run's own exposure: the share held, before any change. */
const evenBy: Record<string, Row> = {}
const exposure = (ev: number) => (ev <= 0 ? 'at or under 0 EV' : ev <= 0.5 ? '0 to +0.5 EV' : 'over +0.5 EV')
type Tube = { run: string; tube: number; kind: string; even?: string; evenP?: number; other?: string; changed: string; p?: number; pRange?: [number, number]; reason?: string }
const flips: Tube[] = []
const newly: Tube[] = []
for (const job of jobs) {
  const r = results.get(key(job))!
  const even = results.get(key({ ...job, lamp: null, cast: null, ev: 0, darken: 0 }))!
  const other = vs?.[key(job)]
  const tally = [(rows[`${job.layout} ${change(job)}`] ??= blank()), (families[family(job)] ??= blank())]
  if (r === even && !r.error) tally.push((evenBy[exposure(r.ev!)] ??= blank()))
  const add = (k: keyof Row) => tally.forEach((t) => t[k]++)
  if (r.error) {
    add('errors')
    continue
  }
  if (r.status === 'failed') add('failed')
  r.roles!.forEach((role, i) => {
    if (role !== 'sample') return
    add('samples')
    if (r.calls![i] === 'held') add('held')
    if (!wrongAt(r, i)) return
    add('wrong')
    const tube = { run: key(job), tube: i - 1, kind: r.kinds![i], changed: r.calls![i], p: r.p![i], pRange: r.pRange![i], reason: r.reasons![i] }
    if (r !== even && !even.error && !wrongAt(even, i)) {
      add('flips')
      flips.push({ ...tube, even: even.calls![i], evenP: even.p![i] })
    }
    if (other && !other.error && !wrongAt(other, i)) {
      add('newly')
      newly.push({ ...tube, other: other.calls![i] })
    }
  })
}
const pct = (r: Row) => ((100 * r.held) / Math.max(1, r.samples)).toFixed(1)
const table = (title: string, t: Record<string, Row>) => {
  console.error(`${title.padEnd(30)} samples  wrong  flips  ${vs ? 'newly  ' : ''}held%  failed  unread`)
  for (const [k, r] of Object.entries(t))
    console.error(
      `${k.padEnd(30)} ${String(r.samples).padStart(7)} ${String(r.wrong).padStart(6)} ${String(r.flips).padStart(6)} ${vs ? String(r.newly).padStart(6) + ' ' : ''}${pct(r).padStart(6)} ${String(r.failed).padStart(7)} ${String(r.errors).padStart(7)}`,
    )
}
console.error(`root ${root}, ${seeds.length} seeds, ${jobs.length} photos, ${Math.round((Date.now() - t0) / 1000)} s`)
if (process.argv.includes('--rows')) table('change', rows)
table('family', families)
table('even light, by own exposure', evenBy)
console.error(`flips: ${flips.length} (${flips.filter((f) => f.even !== 'held').length} read right in even light, the rest held)${vs ? `; newly wrong against ${vsPath}: ${newly.length}` : ''}`)
for (const f of flips) console.error('flip', JSON.stringify(f))
for (const f of newly) console.error('newly', JSON.stringify(f))
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ root, seeds, rows, families, evenBy, flips, newly, reads: Object.fromEntries(results) }) + '\n')
