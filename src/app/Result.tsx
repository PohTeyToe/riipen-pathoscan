import { useEffect, useState, type ReactNode } from 'react'
import type { Assay } from './assays/assay'
import { exportRun } from './csv'
import { LABELS } from './reader'
import { asksRetake, finalCalls, heldReason, saysRetake, tapsDecided, type Run, type Tap } from './run'
import { Shot } from './Shot'
import { getPhoto, getRun, retakePhoto, setTap } from './store'
import { Action, Bar } from './ui'

const MARK = { pos: '+', neg: '−', held: '?' }

/** How many of the positives came from the grower's taps: "1 of the 2 positives is your call." */
export const yourCalls = (tapped: number, positives: number) =>
  `${tapped} of the ${positives} positives ${tapped === 1 ? 'is your call' : 'are your calls'}.`

/** Drawn from the stored run only. The reader doesn't run again. */
export function Result({ run, assay, act, error }: { run: Run; assay: Assay; act: (write: () => Promise<unknown>) => Promise<void>; error: ReactNode }) {
  const url = usePhoto(run.photoKey)
  const read = run.read!
  const roles = run.roles!
  const samples = roles.flatMap((r, i) => (r === 'sample' ? [i] : []))
  const failed = run.outcome === 'failed'
  const positives = (run.readerPositives ?? 0) + (run.tappedPositives ?? 0)
  const calls = finalCalls(run)
  // Every write and the export name the take on show. A stale tab's is refused; the refresh shows the run now.
  const tap = (i: number, t: Tap) => act(() => setTap(run, i, run.taps[i] === t ? null : t))
  const exportNow = () =>
    act(async () => {
      const now = await getRun(run.id)
      if (now?.read && now.take === run.take) await exportRun(now)
    })

  return (
    <div className="screen result">
      <Bar field={run.field} />
      <main className="body">
        <div className="summary">
          {failed ? (
            <>
              <h1>Run failed</h1>
              {/* The reader's own reason, which says what to do: retake the photo, check the controls, or rerun. */}
              {(read.flags.length ? read.flags : ["The controls didn't separate. Rerun with fresh reagents."]).map((f) => (
                <p key={f} className="lead">
                  {f}
                </p>
              ))}
            </>
          ) : (
            <>
              <h1 className="count">
                {positives} of {samples.length} positive
              </h1>
              <p className="lead">
                {run.outcome === 'treat' ? assay.advice.treat : run.outcome === 'dont-treat' ? assay.advice.dontTreat : 'Call the held tubes below.'}
              </p>
              {tapsDecided(run) && (
                <p className="note">
                  {run.outcome === 'treat' ? yourCalls(run.tappedPositives ?? 0, positives) : 'Your calls decided this.'}
                </p>
              )}
              {read.flags.map((f) => (
                // On a run that was read, a retake is only a way to read the held tubes, which the grower can call
                // instead, so it isn't shown as a warning. A flag about the controls is.
                <p key={f} className={saysRetake(f) ? 'note' : 'alert'}>
                  {f}
                </p>
              ))}
              <p className="note">{assay.advice.disclaimer}</p>
            </>
          )}
          {asksRetake(read) && (
            // Back to the photo step for this run: the guide's progress stays, the photo and its read go.
            <Action ghost onClick={() => act(() => retakePhoto(run))}>
              Retake photo
            </Action>
          )}
        </div>
        <Shot src={url} rings={run.regions!.map((region, i) => ({ region, label: LABELS[i] + (roles[i] === 'sample' ? MARK[calls[i]] : ''), tone: calls[i] }))} />
        <div className="calls">
          {failed && <p className="note">Your calls are notes. They don't count.</p>}
          <ol className="tubes">
            {samples.map((i) => (
              <li key={i}>
                <span className="no">{LABELS[i]}</span>
                {read.tubes[i].call === 'held' ? (
                  <span className="pick">
                    {heldReason(read, i) && <span className="why">{heldReason(read, i)}</span>}
                    {run.taps[i] ? <span>Your call</span> : <span className="ask">Look again: yellow or pink?</span>}
                    <span className="choices">
                      {(['pos', 'neg'] as const).map((t) => (
                        <button key={t} type="button" aria-pressed={run.taps[i] === t} onClick={() => tap(i, t)}>
                          {t === 'pos' ? 'Yellow' : 'Pink'}
                        </button>
                      ))}
                    </span>
                  </span>
                ) : (
                  <span className="call">{read.tubes[i].call === 'pos' ? 'Positive' : 'Negative'}</span>
                )}
              </li>
            ))}
          </ol>
          {error}
        </div>
      </main>
      <footer className="actions">
        <Action ghost onClick={() => void exportNow()}>
          Export
        </Action>
        <Action href="#/">Done</Action>
      </footer>
    </div>
  )
}

/** An object URL for the saved photo, freed when the screen closes. */
function usePhoto(key?: string) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!key) return
    let live = true
    let made: string | undefined
    getPhoto(key).then((blob) => {
      if (!live || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [key])
  return url
}
