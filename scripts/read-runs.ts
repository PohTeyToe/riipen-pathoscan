// Reads a batch of tube photos with named tubes and chosen control groups, and writes every tube's
// measurement and both readers' calls as JSON. For scoring the readers against a lab's own records.
//   npx tsx scripts/read-runs.ts <manifest.json> <out.json>
// The manifest is a list of photos:
//   [{ "id": "run-a", "photo": "path/to/photo.png",
//      "tubes": { "t1": [x, y], "t2": [x, y], ... },           // a point on each tube's liquid
//      "groups": [{ "pc": ["t1"], "nc": ["t5"], "samples": ["t2", "t3", "t4"] }] }]
// Each tube is read from the finder's region that contains its point (the nearest region within half a
// region's size), or from a disc at the point if the finder missed it. The naive reader calls every tube.
// The calibrated reader reads each group against that group's own controls; tubes in no group get no
// calibrated call.
import { readFileSync, writeFileSync } from 'node:fs'
import evalData from '../data/eval.json'
import { discRegion, findRegions, measure, type Region } from '../src/lib/find'
import { readByGroup, readCalibrated, readNaive } from '../src/lib/readers'
import type { Role } from '../src/lib/synth'
import { median } from '../src/lib/color'
import { readImage } from './io'

interface Group {
  pc: string[]
  nc: string[]
  samples: string[]
}
interface Entry {
  id: string
  photo: string
  tubes: Record<string, [number, number]>
  groups: Group[]
}

const [manifestPath, outPath] = process.argv.slice(2)
const entries: Entry[] = JSON.parse(readFileSync(manifestPath, 'utf8'))
const { cut, model, band } = evalData.params

const out = entries.map((e) => {
  const img = readImage(e.photo)
  const { regions, paper } = findRegions(img)
  const half = median(regions.map((r) => Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2)) || 12
  const names = Object.keys(e.tubes)
  const taken = new Set<number>()
  const placed = names.map((n) => {
    const [x, y] = e.tubes[n]
    let best = -1
    let bestD = Infinity
    regions.forEach((r, j) => {
      if (taken.has(j)) return
      const dx = Math.max(r.x0 - x, 0, x - r.x1)
      const dy = Math.max(r.y0 - y, 0, y - r.y1)
      const d = Math.hypot(dx, dy)
      if (d <= half && d < bestD) (best = j), (bestD = d)
    })
    if (best >= 0) taken.add(best)
    const region: Region = best >= 0 ? regions[best] : discRegion(x, y, half)
    return { name: n, region, from: best >= 0 ? 'found' : 'placed' }
  })
  const feats = placed.map((p) => measure(img, p.region, paper))
  const naive = readNaive(feats, cut)

  const roles: Role[] = names.map(() => 'sample')
  const groupOf: string[] = names.map(() => '')
  e.groups.forEach((g, k) => {
    const set = (list: string[], role: Role) =>
      list.forEach((n) => {
        const i = names.indexOf(n)
        if (i < 0) throw new Error(`${e.id}: group ${k} names unknown tube ${n}`)
        roles[i] = role
        groupOf[i] = `group ${k + 1}`
      })
    set(g.pc, 'pc')
    set(g.nc, 'nc')
    set(g.samples, 'sample')
  })
  const inGroup = names.map((_, i) => groupOf[i] !== '')
  const cal = readByGroup(
    groupOf.map((g) => g || 'none'),
    (idx) =>
      idx.every((i) => !inGroup[i])
        ? { flags: [], tubes: idx.map(() => ({ call: 'held' as const, reason: 'In no group.' })) }
        : readCalibrated(
            idx.map((i) => feats[i]),
            idx.map((i) => roles[i]),
            model,
            band,
          ),
  )
  return {
    id: e.id,
    photo: e.photo,
    size: [img.width, img.height],
    paper,
    flags: cal.flags,
    tubes: placed.map((p, i) => ({
      name: p.name,
      from: p.from,
      box: [p.region.x0, p.region.y0, p.region.x1, p.region.y1],
      centre: [p.region.cx, p.region.cy],
      group: groupOf[i] || null,
      role: inGroup[i] ? roles[i] : null,
      raw: feats[i]?.raw ?? null,
      rawHue: feats[i]?.rawHue ?? null,
      labHue: feats[i]?.labHue ?? null,
      chroma: feats[i] ? Math.hypot(feats[i]!.lab.a, feats[i]!.lab.b) : null,
      clear: feats[i]?.clear ?? 0,
      naive: naive.tubes[i].call,
      calibrated: inGroup[i] ? cal.tubes[i] : null,
    })),
  }
})
writeFileSync(outPath, JSON.stringify({ params: { cut, model, band }, photos: out }, null, 1))
console.log(`read ${out.length} photos, wrote ${outPath}`)
