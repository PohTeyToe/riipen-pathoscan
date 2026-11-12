import { useEffect, useState, type ReactNode } from 'react'
import type { Assay } from './assays/assay'
import { tubeNames } from './reader'
import { tapsDecided, type Run, type Tap } from './run'
import { Shot } from './Shot'
import { getPhoto, setTap } from './store'
import { Bar } from './ui'

const MARK = { pos: '+', neg: '−', held: '?' }

/** Drawn from the stored run only. The reader doesn't run again. */
export function Result({ run, assay, act, error }: { run: Run; assay: Assay; act: (write: () => Promise<void>) => Promise<void>; error: ReactNode }) {
  const url = usePhoto(run.photoKey)
  const read = run.read!
  const roles = run.roles!
  const names = tubeNames(run.regions!, roles)
  const samples = roles.flatMap((r, i) => (r === 'sample' ? [i] : [])).sort((a, b) => +names[a] - +names[b])
  const failed = run.outcome === 'failed'
  const positives = (run.readerPositives ?? 0) + (run.tappedPositives ?? 0)
  const calls = read.tubes.map((t, i) => (t.call === 'held' && run.taps[i] && !failed ? run.taps[i] : t.call))
  const tap = (i: number, t: Tap) => act(() => setTap(run.id, i, run.taps[i] === t ? null : t, assay.treatAt))

  return (
    <div className="screen">
      <Bar field={run.field} />
      <main className="body">
        {failed ? (
          <>
            <h1>Run failed</h1>
            <p className="lead">The controls didn't separate. Rerun with fresh reagents.</p>
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
                {run.outcome === 'treat' ? `${run.tappedPositives} of the ${positives} positives are your calls.` : 'Your calls decided this.'}
              </p>
            )}
            {read.flags.map((f) => (
              <p key={f} className="alert">
                {f}
              </p>
            ))}
            <p className="note">{assay.advice.disclaimer}</p>
          </>
        )}
        <Shot src={url} rings={run.regions!.map((region, i) => ({ region, label: names[i] + (roles[i] === 'sample' ? MARK[calls[i]] : ''), tone: calls[i] }))} />
        {failed && <p className="note">Your calls are notes. They don't count.</p>}
        <ol className="tubes">
          {samples.map((i) => (
            <li key={i}>
              <span className="no">{names[i]}</span>
              {read.tubes[i].call === 'held' ? (
                <span className="pick">
                  <span>Look again: yellow or pink?</span>
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
      </main>
      <footer className="actions">
        <a className="btn" href="#/">
          Done
        </a>
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
