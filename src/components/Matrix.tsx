import type { Scores } from '../lib/evaluate'
import type { Call } from '../lib/readers'
import type { Truth } from '../lib/synth'

const COLS: { call: Call; label: string }[] = [
  { call: 'pos', label: 'Called positive' },
  { call: 'held', label: 'Held for a look' },
  { call: 'neg', label: 'Called negative' },
]
const ROWS: { truth: Truth; label: string }[] = [
  { truth: 'pos', label: 'Truly positive' },
  { truth: 'neg', label: 'Truly negative' },
]

export const pct = (x: number, digits = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : 'n/a')

/** Truth down the side, call across the top. Right cells are green-ruled, wrong ones brick, held grey. */
export function Matrix({ s, caption, showHeld = true }: { s: Scores; caption?: string; showHeld?: boolean }) {
  const cols = showHeld ? COLS : COLS.filter((c) => c.call !== 'held')
  const max = Math.max(1, ...ROWS.flatMap((r) => cols.map((c) => s.confusion[r.truth][c.call])))
  return (
    <figure className="matrix">
      <table>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">
              <span className="sr">Truth</span>
            </th>
            {cols.map((c) => (
              <th scope="col" key={c.call}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.truth}>
              <th scope="row">{r.label}</th>
              {cols.map((c) => {
                const n = s.confusion[r.truth][c.call]
                const kind = c.call === 'held' ? 'held' : c.call === r.truth ? 'right' : 'wrong'
                return (
                  <td key={c.call} className={`cell ${kind}${n === 0 ? ' zero' : ''}`} style={{ '--fill': (n / max).toFixed(3) } as React.CSSProperties}>
                    <span className="n">{n}</span>
                    <span className="sr">{kind === 'wrong' ? ' wrong' : kind === 'right' ? ' right' : ' held'}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="metrics">
        <span>
          <b>{s.wrong}</b> wrong
        </span>
        {showHeld && (
          <span>
            <b>{s.held}</b> held
          </span>
        )}
        <span>
          sensitivity <b>{pct(s.sensitivity)}</b>
        </span>
        <span>
          specificity <b>{pct(s.specificity)}</b>
        </span>
        <span className="muted">of {s.samples} samples</span>
      </figcaption>
    </figure>
  )
}
