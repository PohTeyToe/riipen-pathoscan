import evalData from '../../data/eval.json'
import type { Scores } from '../lib/evaluate'
import { Matrix, pct } from './Matrix'
import { RealResults } from './RealResults'

const SWEEP_RUNS = evalData.setup.sweep.runsPerPoint

type Point = { x: number; naive: { wrong: number; held: number; samples: number }; calibrated: { wrong: number; held: number; samples: number } }

const KINDS = [
  ['yellow', 'Positive, turned yellow'],
  ['orange', 'Positive, only reached orange'],
  ['unchanged', 'Positive, never changed (inhibited)'],
  ['clear-neg', 'Negative, stayed pink'],
  ['acidic', 'Negative, acidic extract turned it orange'],
] as const

export function EvalSection() {
  const e = evalData
  const t = e.test
  const unchanged = t.byKind.unchanged.naive.samples
  const drift0 = e.sweeps.drift.find((p) => p.x === 0)!
  const driftMin = e.sweeps.drift[0]
  const evMax = e.sweeps.ev[e.sweeps.ev.length - 1]
  return (
    <section id="eval" className="eval">
      <h2>Eval on held-out synthetic runs</h2>
      <p className="lede-sm">
        {e.setup.test.runs.toLocaleString()} runs ({t.naive.samples.toLocaleString()} samples) the readers never saw, drawn with random light ({e.setup.lightRange.kelvin[0]} to{' '}
        {e.setup.lightRange.kelvin[1]} K, {e.setup.lightRange.ev[0]} to +{e.setup.lightRange.ev[1]} stops), a random run pH shift, and the scenario mix:{' '}
        {e.setup.scenarioMix}. Both readers were fit on {e.setup.train.runs} other runs. <span className="tag inline">Synthetic</span>
      </p>
      <div className="pair">
        <div>
          <h3>Naive</h3>
          <Matrix s={t.naive as Scores} showHeld={false} />
        </div>
        <div>
          <h3>Calibrated</h3>
          <Matrix s={t.calibrated as Scores} />
        </div>
      </div>
      <p className="read">
        The calibrated reader makes {t.calibrated.wrong} wrong calls to the naive reader's {t.naive.wrong}, and holds {t.calibrated.held} tubes (
        {pct(t.calibrated.held / t.calibrated.samples)}) for a look. {unchanged} of the wrong calls on both sides are positives that never changed colour; no colour
        reader gets those. Of the calls it does make, the calibrated reader gets {pct(t.calibrated.accuracyCalled, 1)} right; the naive one,{' '}
        {pct(t.naive.accuracyCalled, 1)}. The finder missed {t.finderMissed} of {e.setup.test.runs * 10} tubes.
      </p>

      <h3>What each reader did with each kind of tube</h3>
      <div className="table-wrap">
        <table className="kinds">
          <thead>
            <tr>
              <th scope="col">Tube</th>
              <th scope="col">Count</th>
              <th scope="col">Naive wrong</th>
              <th scope="col">Calibrated wrong</th>
              <th scope="col">Calibrated held</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map(([k, label]) => {
              const s = t.byKind[k]
              return (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  <td>{s.naive.samples}</td>
                  <td>{s.naive.wrong}</td>
                  <td>{s.calibrated.wrong}</td>
                  <td>{s.calibrated.held}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="read">
        The orange middle is where a fixed cut fails. It calls {t.byKind.orange.naive.wrong} of {t.byKind.orange.naive.samples} weak positives negative
        and has no way to say it isn't sure. The calibrated reader holds {t.byKind.orange.calibrated.held} of them and gets {t.byKind.orange.calibrated.wrong}{' '}
        wrong. It also holds {t.byKind.acidic.calibrated.held} of the {t.byKind.acidic.calibrated.samples} acidic negatives, which is the honest answer for a
        colour that sits between the controls.
      </p>

      <h3>When conditions move</h3>
      <p className="read">
        Wrong calls per 100 samples, {e.setup.sweep.runsPerPoint} runs per point, everything else held at 5500 K, 0 stops and no pH shift. The dashed line is
        the share the calibrated reader held.
      </p>
      <div className="sweeps">
        <Sweep title="Light colour" unit="K" points={e.sweeps.kelvin} fmt={(x) => `${x / 1000}k`} />
        <Sweep title="Exposure" unit="stops" points={e.sweeps.ev} fmt={(x) => `${x > 0 ? '+' : ''}${x}`} />
        <Sweep title="Run pH shift" unit="" points={e.sweeps.drift} fmt={(x) => `${x > 0 ? '+' : ''}${x}`} />
      </div>
      <p className="read">
        I expected light colour to break the fixed cut. In this model it doesn't: a warm cast squeezes hues together, and the best single cut sits near the
        hue that moves least. What breaks it is a shift the whole run shares, like a master-mix lot that starts more basic, because it has no control to
        compare against: {drift0.naive.wrong} wrong at no shift, {driftMin.naive.wrong} at {driftMin.x}. Blown-out photos hurt the calibrated reader too. At
        +{evMax.x} stops the finder loses {evMax.missed} of {SWEEP_RUNS * 10} tubes and the calibrated reader holds {evMax.calibrated.held}{' '}
        samples rather than guess.
      </p>

      <RealResults />
    </section>
  )
}

function Sweep({ title, points, fmt, unit }: { title: string; points: Point[]; fmt: (x: number) => string; unit: string }) {
  const W = 300
  const H = 170
  const m = { l: 34, r: 10, t: 12, b: 28 }
  const xs = points.map((p) => p.x)
  const per = (n: number, d: number) => (100 * n) / d
  const series = {
    naive: points.map((p) => per(p.naive.wrong, p.naive.samples)),
    cal: points.map((p) => per(p.calibrated.wrong, p.calibrated.samples)),
    held: points.map((p) => per(p.calibrated.held, p.calibrated.samples)),
  }
  const yMax = Math.max(10, Math.ceil(Math.max(...series.naive, ...series.cal, ...series.held) / 10) * 10)
  const X = (x: number) => m.l + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - (y / yMax) * (H - m.t - m.b)
  const path = (ys: number[]) => ys.map((y, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`).join('')
  const yTicks = [0, yMax / 2, yMax]
  const xTicks = [xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]]
  return (
    <figure className="sweep">
      <figcaption>
        {title}
        {unit && <span className="muted"> ({unit})</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: wrong calls per 100 samples, naive versus calibrated`}>
        {yTicks.map((y) => (
          <g key={y}>
            <line x1={m.l} x2={W - m.r} y1={Y(y)} y2={Y(y)} className="grid" />
            <text x={m.l - 6} y={Y(y) + 4} textAnchor="end" className="ax">
              {y}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={x} x={X(x)} y={H - 8} textAnchor="middle" className="ax">
            {fmt(x)}
          </text>
        ))}
        <path d={path(series.held)} className="ln held" />
        <path d={path(series.naive)} className="ln naive" />
        <path d={path(series.cal)} className="ln cal" />
        <text x={X(xs[xs.length - 1])} y={Y(series.naive[series.naive.length - 1]) - 6} textAnchor="end" className="lbl naive">
          naive
        </text>
      </svg>
      <div className="legend" aria-hidden>
        <span className="k naive">Naive wrong</span>
        <span className="k cal">Calibrated wrong</span>
        <span className="k held">Calibrated held</span>
      </div>
    </figure>
  )
}
