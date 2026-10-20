// Runs the page's own code on any photo of a run and prints what each reader sees. Used for the
// PathoScan case-study measurement in the README; the photo itself is not in this repo.
//   npm run measure -- <photo> [labels comma-separated, left to right] [discs "x:y:r;x:y:r;..."]
// With discs, it reads those spots (the page's "Place tubes by hand") instead of finding the liquid.
import evalData from '../data/eval.json'
import { discRegion, findRegions, globalPaper, measure } from '../src/lib/find'
import { readCalibrated, readMidpoint, readNaive } from '../src/lib/readers'
import type { Role } from '../src/lib/synth'
import { readImage } from './io'

const [path, names, discs] = process.argv.slice(2)
const img = readImage(path)
const { regions, paper } = discs
  ? {
      regions: discs.split(';').map((d) => {
        const [x, y, r] = d.split(':').map(Number)
        return discRegion(x, y, r)
      }),
      paper: globalPaper(img),
    }
  : findRegions(img)
const feats = regions.map((r) => measure(img, r, paper))
const roles: Role[] = regions.map((_, i) => (i === 0 ? 'pc' : i === 1 ? 'nc' : 'sample'))
const label = names ? names.split(',') : regions.map((_, i) => (i === 0 ? 'PC' : i === 1 ? 'NC' : `S${i - 1}`))
const { cut, model, band } = evalData.params
const n = readNaive(feats, cut)
const m = readMidpoint(feats, roles)
const c = readCalibrated(feats, roles, model, band)
console.log(`${img.width}x${img.height}, ${regions.length} regions found, paper ${paper.map((v) => v.toFixed(3)).join(' ')}`)
console.log('tube   box(x0,y0,x1,y1)        clear  rawRGB         rawHue  labHue    s     p     naive  midpoint  calibrated')
regions.forEach((r, i) => {
  const f = feats[i]
  const t = c.tubes[i]
  console.log(
    [
      (label[i] ?? '?').padEnd(6),
      `${r.x0},${r.y0},${r.x1},${r.y1}`.padEnd(22),
      String(f?.clear ?? 0).padStart(6),
      (f ? f.raw.join(',') : '-').padEnd(13),
      (f?.rawHue.toFixed(1) ?? '-').padStart(7),
      (f?.labHue.toFixed(1) ?? '-').padStart(7),
      (t.s?.toFixed(2) ?? '-').padStart(6),
      (t.p?.toFixed(2) ?? '-').padStart(5),
      n.tubes[i].call.padStart(6),
      m.tubes[i].call.padStart(9),
      t.call.padStart(11),
    ].join(' '),
  )
})
console.log('midpoint:', m.tubes[2]?.reason, '| naive cut', cut, '| flags:', c.flags.join(' / ') || 'none')
