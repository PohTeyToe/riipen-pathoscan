// Scores both readers on the 27 real photos (Zenodo 4476336, CC0) against the hand-made labels in
// data/real/labels.json. Reads the same downscaled copies the page shows (public/real). Writes
// data/real-eval.json. Run: npm run eval:real
import { readFileSync, writeFileSync } from 'node:fs'
import evalData from '../data/eval.json'
import { emptyConfusion, fitCut, score, type Confusion } from '../src/lib/evaluate'
import { findRegions } from '../src/lib/find'
import { EXCLUDED, readRealImage, type Labels } from '../src/lib/real'
import { QC, type Call } from '../src/lib/readers'
import { readImage } from './io'

const labels: Labels = JSON.parse(readFileSync(new URL('../data/real/labels.json', import.meta.url), 'utf8'))
const params = evalData.params

const all = { naive: emptyConfusion(), calibrated: emptyConfusion(), paper: emptyConfusion() }
const ctl = { naive: emptyConfusion(), calibrated: emptyConfusion(), paper: emptyConfusion() }
const word: Record<Call, string> = { pos: 'positive', neg: 'negative', held: 'held' }
const misses: object[] = []
const finder = { expected: 0, found: 0, extra: 0 }
let images = 0
let wellsRead = 0
let noControls = 0
let paperCalled = 0
const t0 = Date.now()
// For the hindsight baseline and the QC what-if below.
const hues: number[] = []
const ys: number[] = []
const gapWhatIf = { minControlGap: 10, cal: emptyConfusion() }
const onPaper = { calibrated: emptyConfusion(), paper: emptyConfusion() }

for (const image of labels.images) {
  if (EXCLUDED[image.file]) continue
  images++
  const img = readImage(new URL(`../public/real/${image.file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const r = readRealImage(img, image, params)
  wellsRead += r.wells.length
  const hasControls = (g: string) => r.roles.some((x, i) => x === 'pc' && r.groups[i] === g) && r.roles.some((x, i) => x === 'nc' && r.groups[i] === g)
  r.wells.forEach((w, i) => {
    if (w.role !== 'sample' || w.truth === 'unknown') return
    const t = w.truth
    const n = r.naive.tubes[i].call
    const c = r.calibrated.tubes[i].call
    const pc: Call | null = w.paper_call === 'pos' ? 'pos' : w.paper_call === 'neg' ? 'neg' : w.paper_call === 'inconclusive' ? 'held' : null
    const withCtl = hasControls(r.groups[i])
    if (!withCtl) noControls++
    for (const [set, on] of [[all, true], [ctl, withCtl]] as [typeof all, boolean][]) {
      if (!on) continue
      set.naive[t][n]++
      set.calibrated[t][c]++
    }
    if (pc && withCtl) {
      ctl.paper[t][pc]++
      onPaper.paper[t][pc]++
      onPaper.calibrated[t][c]++
      paperCalled++
    }
    if (withCtl && r.feats[i]) {
      hues.push(r.feats[i]!.rawHue)
      ys.push(t === 'pos' ? 1 : 0)
    }
    if (pc) all.paper[t][pc]++
    // The page lists the calibrated reader's wrong calls; held and naive-only misses are counted, not listed.
    if (withCtl && c !== 'held' && c !== t)
      misses.push({
        file: image.file,
        figure: image.figure,
        well: r.groups[i] ? `${w.id} (${r.groups[i]})` : w.id,
        truth: t,
        naive: word[n],
        calibrated: word[c],
        reason: r.calibrated.tubes[i].reason,
        basis: w.basis.length > 140 ? w.basis.slice(0, 137) + '...' : w.basis,
        paper: w.paper_call ?? 'not reported',
      })
  })
  // What-if: the same photo with a looser control-gap check.
  const keep = QC.minControlGap
  QC.minControlGap = gapWhatIf.minControlGap
  const loose = readRealImage(img, image, params)
  QC.minControlGap = keep
  r.wells.forEach((w, i) => {
    if (w.role === 'sample' && w.truth !== 'unknown' && hasControls(r.groups[i])) gapWhatIf.cal[w.truth][loose.calibrated.tubes[i].call]++
  })

  // How the automatic finder does on the same photo: a labelled well counts as found if a region covers its centre.
  const { regions } = findRegions(img)
  const used = new Set<number>()
  for (const w of r.wells) {
    finder.expected++
    const k = regions.findIndex((g, j) => !used.has(j) && w.x * img.width >= g.x0 && w.x * img.width <= g.x1 && w.y * img.height >= g.y0 && w.y * img.height <= g.y1)
    if (k >= 0) {
      used.add(k)
      finder.found++
    }
  }
  finder.extra += regions.length - used.size
}

const s = (c: Confusion) => score(c)
const out = {
  generated: new Date().toISOString().slice(0, 10),
  note: 'Real photos, CC0. Truth from the paper (RT-qPCR, set status or controls), never from colour. See data/real/labels.json.',
  images,
  excluded: Object.keys(EXCLUDED),
  wells: wellsRead,
  scored: s(all.naive).samples,
  withControls: { scored: s(ctl.naive).samples, naive: s(ctl.naive), calibrated: s(ctl.calibrated), paper: s(ctl.paper), paperCalled },
  allScored: { naive: s(all.naive), calibrated: s(all.calibrated) },
  noControls,
  onPaperCalled: { calibrated: s(onPaper.calibrated), paper: s(onPaper.paper) },
  hindsightCut: (() => {
    const cut = fitCut(hues, ys)
    const c = emptyConfusion()
    hues.forEach((h, i) => c[ys[i] ? 'pos' : 'neg'][h >= cut ? 'pos' : 'neg']++)
    return { cut, ...s(c) }
  })(),
  gapWhatIf: { minControlGap: gapWhatIf.minControlGap, calibrated: s(gapWhatIf.cal) },
  misses,
  finder,
  seconds: Math.round((Date.now() - t0) / 1000),
}
writeFileSync(new URL('../data/real-eval.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify({ hindsight: [out.hindsightCut.cut, out.hindsightCut.wrong], gap10: [out.gapWhatIf.calibrated.wrong, out.gapWhatIf.calibrated.held], onPaper: [out.onPaperCalled.calibrated.wrong, out.onPaperCalled.calibrated.held, out.onPaperCalled.paper.wrong] }))
console.log(JSON.stringify({ images, wellsRead, scored: out.scored, noControls, ctl: { n: out.withControls.scored, naive: [out.withControls.naive.wrong, out.withControls.naive.held], cal: [out.withControls.calibrated.wrong, out.withControls.calibrated.held], paper: [out.withControls.paper.wrong, out.withControls.paper.held, paperCalled] }, all: { naive: out.allScored.naive.wrong, cal: [out.allScored.calibrated.wrong, out.allScored.calibrated.held] }, finder, misses: misses.length }))
