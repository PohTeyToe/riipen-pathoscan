// The README's check of PathoScan's published greenhouse photo (case-study PDF, page 4, 810x296 px). The
// photo is not in this repo: extract it from https://www.pathoscan.com/s/PathoScan-Greenhouse-Trial-Case-Study-1.pdf
// and pass its path. Reads the ten tube tips at hand-placed spots (the page's "Place tubes by hand"), then
// repeats the read at 27 placements (radius 3, 4 or 5 px, shifted up to 2 px) to see which results hold.
//   npx tsx scripts/case-study-check.ts <photo.png>
import evalData from '../data/eval.json'
import { discRegion, globalPaper, measure } from '../src/lib/find'
import { readCalibrated, readMidpoint, readNaive, type Call } from '../src/lib/readers'
import type { Role } from '../src/lib/synth'
import { readImage } from './io'

// Tip centres in the 810x296 image, left to right, as laid out in the photo.
const TIPS = [[165, 185], [210, 187], [277, 180], [320, 179], [370, 188], [422, 195], [500, 203], [573, 204], [627, 213], [712, 234]]
const NAMES = ['PC', 'NC', 'PS162', 'PS163', 'PS164', 'PS165', 'PS166', 'PS167', 'PS168', 'PS169']
// The handwritten calls under each sample (PS163's is a corrected "−").
const HAND: (Call | null)[] = [null, null, 'pos', 'neg', 'neg', 'pos', 'pos', 'pos', 'neg', 'neg']
const roles: Role[] = NAMES.map((_, i) => (i === 0 ? 'pc' : i === 1 ? 'nc' : 'sample'))
const MARKED_POS = [2, 5, 6, 7]

const img = readImage(process.argv[2])
const paper = globalPaper(img)
const { cut, model, band } = evalData.params
const count = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})

const res = { midpointFlips: [] as string[], pcBelow: [] as string[], naiveAgrees: [] as string[], calibrated: [] as string[] }
for (const r of [3, 4, 5])
  for (const dx of [-2, 0, 2])
    for (const dy of [-2, 0, 2]) {
      const feats = TIPS.map(([x, y]) => measure(img, discRegion(x + dx, y + dy, r), paper))
      const mid = readMidpoint(feats, roles)
      const nai = readNaive(feats, cut)
      const cal = readCalibrated(feats, roles, model, band)
      if (r === 4 && dx === 0 && dy === 0) {
        console.log('Centre placement, radius 4 px:')
        NAMES.forEach((n, i) =>
          console.log(`  ${n.padEnd(6)} raw hue ${feats[i]?.rawHue.toFixed(1).padStart(5)}°  clear px ${String(feats[i]?.clear).padStart(3)}  hand ${HAND[i] ?? 'ctrl'}  naive ${nai.tubes[i].call}  midpoint ${mid.tubes[i].call}  calibrated ${cal.tubes[i].call}`),
        )
        console.log(`  ${mid.tubes[2].reason}; flags: ${cal.flags.join(' ') || 'none'}`)
      }
      res.midpointFlips.push(NAMES.filter((_, i) => HAND[i] && mid.tubes[i].call !== HAND[i]).join('+') || 'none')
      res.pcBelow.push(String(MARKED_POS.filter((i) => feats[i]!.rawHue > feats[0]!.rawHue).length))
      res.naiveAgrees.push(String(NAMES.filter((_, i) => HAND[i] && nai.tubes[i].call === HAND[i]).length))
      res.calibrated.push(
        NAMES.map((n, i) => (HAND[i] ? `${n.slice(2)}:${cal.tubes[i].call}` : ''))
          .filter(Boolean)
          .join(' '),
      )
    }
console.log('Over 27 placements:')
console.log('  tubes marked + that read more yellow (higher raw hue) than the PC, of 4:', count(res.pcBelow))
console.log('  midpoint rule disagrees with the handwritten call on:', count(res.midpointFlips))
console.log('  naive cut agrees with the handwritten calls (of 8):', count(res.naiveAgrees))
console.log('  calibrated calls:', count(res.calibrated))
