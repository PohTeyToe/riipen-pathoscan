import type { Scores } from '../lib/evaluate'
import { Matrix } from './Matrix'

interface Miss {
  file: string
  figure: string
  well: string
  truth: 'pos' | 'neg'
  naive: string
  calibrated: string
  reason: string
  basis: string
  paper: string
}

export interface RealEval {
  generated: string
  images: number
  excluded: string[]
  wells: number
  scored: number
  withControls: { scored: number; naive: Scores; calibrated: Scores; paper: Scores; paperCalled: number }
  allScored: { naive: Scores; calibrated: Scores }
  noControls: number
  onPaperCalled: { calibrated: Scores; paper: Scores }
  hindsightCut: Scores & { cut: number }
  gapWhatIf: { minControlGap: number; calibrated: Scores }
  misses: Miss[]
  finder: { expected: number; found: number; extra: number }
}

const found = import.meta.glob<{ default: RealEval }>('../../data/real-eval.json', { eager: true })
const REAL: RealEval | null = Object.values(found)[0]?.default ?? null

export function RealResults() {
  if (!REAL) return null
  const r = REAL
  const w = r.withControls
  const calWrong = r.misses.filter((m) => m.calibrated !== 'held' && m.calibrated.slice(0, 3) !== m.truth)
  return (
    <>
      <h2 className="sub-h">On the real photos</h2>
      <p className="lede-sm">
        {r.scored} sample wells with a known result in {r.images} CC0 photos of SARS-CoV-2 RT-LAMP plates (Bokelmann et al. 2021). The truth is the paper's
        RT-qPCR or sample-set status, never the colour. One more photo was taken before incubation and isn't scored. These aren't plant samples or tubes on
        paper, so read this as a check that the method carries over, not as a score. <span className="tag inline real">Real</span>
      </p>
      <p className="read">
        The matrices count the {w.scored} wells whose assay has both a positive and a negative control on the same plate. The calibrated reader can't read
        the other {r.noControls} and holds them.
      </p>
      <div className="pair">
        <div>
          <h3>Naive</h3>
          <Matrix s={w.naive} showHeld={false} />
        </div>
        <div>
          <h3>Calibrated</h3>
          <Matrix s={w.calibrated} />
        </div>
      </div>
      <ul className="limits">
        <li>
          The naive cut was learned on my synthetic runs and doesn't carry over: {w.naive.wrong} wrong of {w.scored}. On these plates the negatives read
          orange, not pink. The best single cut for these exact wells, picked with hindsight, is {r.hindsightCut.cut}°, and it gets {r.hindsightCut.wrong}{' '}
          wrong. A fixed cut works once someone retunes it for each assay, camera and light.
        </li>
        <li>
          The calibrated reader, with nothing retuned, gets {w.calibrated.wrong} wrong and holds {w.calibrated.held}. Most of the held wells sit on plates
          whose controls are closer than the 20° minimum I set on synthetic runs. At a {r.gapWhatIf.minControlGap}° minimum it would hold{' '}
          {r.gapWhatIf.calibrated.held} and get {r.gapWhatIf.calibrated.wrong} wrong. I left 20° in place, because changing it after seeing these results would
          be tuning on the test set.
        </li>
        <li>
          The paper's own phone hue reads, on the {r.onPaperCalled.paper.samples} of these wells where it reports one, get {r.onPaperCalled.paper.wrong} wrong.
          On those same wells the calibrated reader gets {r.onPaperCalled.calibrated.wrong} wrong and holds {r.onPaperCalled.calibrated.held}. Their cut was set
          for this assay; this reader never saw these plates before.
        </li>
        <li>
          The scores use the labelled well positions. Run on the same photos, the automatic finder covers {r.finder.found} of {r.finder.expected} labelled
          wells and adds {r.finder.extra} regions that aren't wells.
        </li>
      </ul>
      {calWrong.length > 0 && (
        <details className="misses" open>
          <summary>Every wrong call the calibrated reader made ({calWrong.length})</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Photo</th>
                  <th scope="col">Well</th>
                  <th scope="col">Truth</th>
                  <th scope="col">Calibrated</th>
                  <th scope="col">Naive</th>
                  <th scope="col">Paper's call</th>
                  <th scope="col">Why the truth is what it is</th>
                </tr>
              </thead>
              <tbody>
                {calWrong.map((m) => (
                  <tr key={m.file + m.well}>
                    <td>{m.figure}</td>
                    <td>{m.well}</td>
                    <td>{m.truth === 'pos' ? 'positive' : 'negative'}</td>
                    <td>{m.calibrated}</td>
                    <td>{m.naive}</td>
                    <td>{m.paper}</td>
                    <td>{m.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  )
}
