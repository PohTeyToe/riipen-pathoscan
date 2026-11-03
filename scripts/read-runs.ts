// Reads a batch of tube photos with named tubes and chosen control groups, and writes every tube's
// measurement and both readers' calls as JSON. For scoring the readers against a lab's own records.
//   npx tsx scripts/read-runs.ts <manifest.json> <out.json>
// The manifest is a list of photos:
//   [{ "id": "run-a", "photo": "path/to/photo.png",
//      "tubes": { "t1": [x, y], "t2": [x, y], ... },           // a point on each tube's liquid
//      "groups": [{ "pc": ["t1"], "nc": ["t5"], "samples": ["t2", "t3", "t4"] }] }]
// Each tube is read from the finder region its point falls in (or the nearest one within half a region's
// size), or from a disc at the point if the finder missed it. The naive reader calls every tube. The
// calibrated reader reads each group against that group's own controls. Groups may share controls.
// The output holds a lab's measurements, so it must be written outside this repo.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import evalData from '../data/eval.json'
import { median } from '../src/lib/color'
import { discRegion, findRegions, measure } from '../src/lib/find'
import { readNaive } from '../src/lib/readers'
import { checkOutput, matchPoints, readGroups, type Group } from './batch'
import { readImage } from './io'

interface Entry {
  id: string
  photo: string
  tubes: Record<string, [number, number]>
  groups: Group[]
}

const [manifestPath, outPath] = process.argv.slice(2)
if (!manifestPath || !outPath) throw new Error('usage: read-runs.ts <manifest.json> <out.json>')
checkOutput(manifestPath, outPath, fileURLToPath(new URL('..', import.meta.url)))

const entries: Entry[] = JSON.parse(readFileSync(manifestPath, 'utf8'))
const { cut, model, band } = evalData.params

const photos = entries.map((e) => {
  const img = readImage(e.photo)
  const { regions, paper } = findRegions(img)
  const half = median(regions.map((r) => Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2)) || 12
  const names = Object.keys(e.tubes)
  const match = matchPoints(names.map((n) => e.tubes[n]), regions, half)
  const placed = names.map((n, i) => {
    const j = match[i]
    const [x, y] = e.tubes[n]
    return { name: n, region: j === null ? discRegion(x, y, half) : regions[j], from: j === null ? 'placed' : 'found' }
  })
  const feats = placed.map((p) => measure(img, p.region, paper))
  const naive = readNaive(feats, cut)
  const cal = readGroups(names, feats, e.groups, model, band, e.id)
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
      groups: cal.groups[i],
      role: cal.roles[i],
      raw: feats[i]?.raw ?? null,
      rawHue: feats[i]?.rawHue ?? null,
      labHue: feats[i]?.labHue ?? null,
      chroma: feats[i] ? Math.hypot(feats[i]!.lab.a, feats[i]!.lab.b) : null,
      clear: feats[i]?.clear ?? 0,
      naive: naive.tubes[i].call,
      calibrated: cal.tubes[i],
    })),
  }
})
writeFileSync(resolve(outPath), JSON.stringify({ params: { cut, model, band }, photos }, null, 1))
console.log(`read ${photos.length} photos, wrote ${resolve(outPath)}`)
