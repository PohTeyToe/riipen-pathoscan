import evalData from '../../data/eval.json'
import { pct } from './Matrix'

const T = evalData.test
const COLS = 50
const ROWS = 20
const CELLS = COLS * ROWS
const PER = T.naive.samples / CELLS
const L = evalData.setup.lightRange
/** Exposure in stops with a true minus sign and an explicit plus. */
const stops = (x: number) => (x < 0 ? `−${-x}` : x > 0 ? `+${x}` : '0')

export type Part = { key: 'pos' | 'neg' | 'held' | 'wrong'; n: number }

/** Split CELLS squares between the parts in proportion to their counts (largest remainder), so they always add up. */
export function apportion(parts: Part[]) {
  const total = parts.reduce((a, p) => a + p.n, 0)
  const raw = parts.map((p) => (p.n / total) * CELLS)
  const out = raw.map(Math.floor)
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem)
  for (let k = 0; k < CELLS - out.reduce((a, b) => a + b, 0); k++) out[order[k].i]++
  return parts.map((p, i) => ({ ...p, cells: out[i] }))
}

/** A unit chart: one square per PER samples, filled column by column, so each kind of call reads as a band. */
function Waffle({ parts, label }: { parts: Part[]; label: string }) {
  const s = 10
  const g = 2
  let k = 0
  const paths = apportion(parts).map((p) => {
    let d = ''
    for (let c = 0; c < p.cells; c++, k++) {
      const col = Math.floor(k / ROWS)
      const row = k % ROWS
      d += `M${col * s} ${row * s}h${s - g}v${s - g}h${-(s - g)}z`
    }
    return { key: p.key, d }
  })
  return (
    <svg className="waffle" viewBox={`0 0 ${COLS * s - g} ${ROWS * s - g}`} role="img" aria-label={label}>
      {paths.map((p) => (
        <path key={p.key} className={`w-${p.key}`} d={p.d} />
      ))}
    </svg>
  )
}

export function Scoreboard() {
  const n = T.naive
  const c = T.calibrated
  const orange = T.byKind.orange
  const unchanged = T.byKind.unchanged
  const fmt = (x: number) => x.toLocaleString('en-CA')
  const naiveParts: Part[] = [
    { key: 'neg', n: n.confusion.neg.neg },
    { key: 'pos', n: n.confusion.pos.pos },
    { key: 'wrong', n: n.wrong },
  ]
  const calParts: Part[] = [
    { key: 'neg', n: c.confusion.neg.neg },
    { key: 'pos', n: c.confusion.pos.pos },
    { key: 'held', n: c.held },
    { key: 'wrong', n: c.wrong },
  ]
  return (
    <section className="score" aria-labelledby="score-h">
      <div className="wrap">
        <p className="eyebrow">Eval</p>
        <h2 id="score-h">
          {fmt(evalData.setup.test.runs)} runs it never saw. {fmt(n.samples)} samples.
        </h2>
        <div className="score-pair">
          <figure className="score-one">
            <figcaption>
              <span className="score-name">Fixed cut</span>
              <span className="score-big">
                <b>{fmt(n.wrong)}</b> wrong
              </span>
              <span className="score-sub">
                never holds · {pct(n.accuracyCalled, 1)} right on calls made
              </span>
            </figcaption>
            <Waffle parts={naiveParts} label={`Fixed cut: ${fmt(n.wrong)} wrong of ${fmt(n.samples)} samples, none held`} />
          </figure>
          <figure className="score-one">
            <figcaption>
              <span className="score-name">Tube Reader</span>
              <span className="score-big">
                <b>{fmt(c.wrong)}</b> wrong
              </span>
              <span className="score-sub">
                {fmt(c.held)} held ({pct(c.held / c.samples)}) · {pct(c.accuracyCalled, 1)} right on calls made
              </span>
            </figcaption>
            <Waffle parts={calParts} label={`Tube Reader: ${fmt(c.wrong)} wrong and ${fmt(c.held)} held of ${fmt(c.samples)} samples`} />
          </figure>
        </div>
        <div className="key" aria-hidden>
          <span className="k neg">right, negative</span>
          <span className="k pos">right, positive</span>
          <span className="k held">held for a look</span>
          <span className="k wrong">wrong</span>
          <span className="k-per">one square = {PER} samples</span>
        </div>
        <ul className="score-notes">
          <li>
            <b>Orange tubes are where a fixed cut loses.</b> It calls {fmt(orange.naive.wrong)} of {fmt(orange.naive.samples)} weak positives negative. Tube Reader
            holds {fmt(orange.calibrated.held)} and gets {orange.calibrated.wrong} wrong.
          </li>
          <li>
            <b>No colour reader can call a tube that never changed.</b> {fmt(unchanged.naive.samples)} positives never changed colour enough to see: fixed cut{' '}
            {unchanged.naive.wrong} wrong, Tube Reader {unchanged.calibrated.wrong} wrong and {unchanged.calibrated.held} held.
          </li>
        </ul>
        <p className="fine">
          Synthetic runs drawn by code: {evalData.setup.scenarioMix}, each with random light ({L.kelvin[0]} to {L.kelvin[1]} K, {stops(L.ev[0])} to{' '}
          {stops(L.ev[1])} stops) and a random run pH shift. Both readers were fit on {evalData.setup.train.runs} other runs. The fixed cut is the best single hue cut for those runs ({evalData.params.cut}°).
        </p>
      </div>
    </section>
  )
}
