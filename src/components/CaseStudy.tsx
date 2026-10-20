import { allPosPastPc, always, CASE_URL, flips, MID, naiveAllEight, PC, PLACEMENTS, posTubes, rows } from '../caseStudy'

const D = [-10, 45] as const
const at = (h: number) => `${(((h - D[0]) / (D[1] - D[0])) * 100).toFixed(2)}%`
const dot = (h: number) => `hsl(${(h + 360) % 360} 78% 60%)`
/** Tubes the midpoint rule flips at some placements but not all. */
const edges = rows.filter((r) => r.hand !== 'control' && flips(r.tube) > 0 && flips(r.tube) < PLACEMENTS)

export function CaseStudy() {
  return (
    <section className="case wrap" aria-labelledby="case-h">
      <div className="case-head">
        <p className="eyebrow">Measured on a real run</p>
        <h2 id="case-h">The same pattern is in PathoScan's case-study photo.</h2>
      </div>
      <div className="case-text">
        <ul className="case-facts">
          <li>
            The positive control reads less yellow than <b>all {posTubes.length}</b> tubes marked +.
          </li>
          <li>
            A midpoint rule calls <b>{always.join(' and ')}</b> positive. The handwritten call is −.
          </li>
        </ul>
      </div>

      <figure className="dotplot" aria-labelledby="case-cap">
        <div className="dp-grid" role="table" aria-label="Camera hue of each tube in the case-study photo">
          <div className="dp-axis" role="row">
            <span role="columnheader">Tube</span>
            <span role="columnheader" className="dp-hand-h">
              Hand
            </span>
            <span role="columnheader">
              <span className="sr">Camera hue</span>
            </span>
            <span role="columnheader">
              <span className="sr">Midpoint rule</span>
            </span>
          </div>
          <div className="dp-lines" aria-hidden>
            <span className="dp-zone" style={{ left: at(MID), width: `calc(${at(PC)} - ${at(MID)})` }} />
            <span className="dp-line mid" style={{ left: at(MID) }}>
              <span>midpoint {MID.toFixed(1)}°</span>
            </span>
            <span className="dp-line pc" style={{ left: at(PC) }}>
              <span>PC {PC.toFixed(1)}°</span>
            </span>
          </div>
          {rows.map((r) => {
            const n = flips(r.tube)
            const sample = r.hand !== 'control'
            const state = !sample ? 'ctrl' : n === PLACEMENTS ? 'flip' : n > 0 ? 'edge' : ''
            return (
              <div key={r.tube} role="row" className={`dp-row ${state} ${r.hand}`}>
                <span role="cell" className="dp-tube">
                  {r.tube.replace('PS', '')}
                </span>
                <span role="cell" className="dp-hand" aria-label={sample ? `handwritten ${r.hand === 'pos' ? 'positive' : 'negative'}` : 'control'}>
                  {sample ? (r.hand === 'pos' ? '+' : '-') : ''}
                </span>
                <span role="cell" className="dp-track">
                  <span className="dp-dot" style={{ left: at(r.rawHue), background: dot(r.rawHue) }}>
                    <span className="sr">{r.rawHue.toFixed(1)}°</span>
                  </span>
                </span>
                <span role="cell" className="dp-note">
                  {state === 'flip' ? (
                    <>
                      <b>×</b> midpoint says +
                    </>
                  ) : state === 'edge' ? (
                    `flips at ${n} of ${PLACEMENTS}`
                  ) : (
                    ''
                  )}
                </span>
              </div>
            )
          })}
          <div className="dp-foot" aria-hidden>
            <span className="dp-foot-label">Camera hue</span>
            <span className="dp-scale">
              {[0, 10, 20, 30, 40].map((t) => (
                <span key={t} className="dp-tick" style={{ left: at(t) }}>
                  {t}°
                </span>
              ))}
            </span>
          </div>
        </div>
        <p className="dp-legend">
          Shaded rows: the midpoint rule disagrees with the handwritten call at all {PLACEMENTS} placements. Grey rings: at some (
          {edges.map((r) => `${r.tube.replace('PS', '')} at ${flips(r.tube)}`).join(', ')}).
        </p>
        <figcaption id="case-cap" className="fine">
          Alternaria photo, page 4 of PathoScan's{' '}
          <a href={CASE_URL} rel="noreferrer">
            greenhouse case study
          </a>{' '}
          (Nov 24 visit). Median hue of each tube tip at the centre placement. It's one 810 by 296 JPEG with tips 6 to 10 px across, so
          read it as rough: I repeated the read at {PLACEMENTS} placements. The control was less yellow than all four + tubes at {allPosPastPc} of them.
          The fixed cut from the synthetic runs matched all eight handwritten calls at {naiveAllEight}.
        </figcaption>
      </figure>
    </section>
  )
}
