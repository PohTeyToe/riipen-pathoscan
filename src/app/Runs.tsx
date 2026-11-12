import { useEffect, useState } from 'react'
import { useInstall } from './install'
import { OUTCOME_LABEL, type Run } from './run'
import { listRuns } from './store'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [failed, setFailed] = useState(false)
  const install = useInstall()
  useEffect(() => {
    listRuns().then(setRuns, () => setFailed(true))
  }, [])

  return (
    <div className="screen">
      <header className="bar">
        <span className="brand">PathoScan Field</span>
      </header>
      <main className="body">
        <h1>Runs</h1>
        {install === 'ios' && <p className="note">Install first: tap Share, then Add to Home Screen.</p>}
        {install && install !== 'ios' && (
          <button type="button" className="btn ghost" onClick={install.prompt}>
            Install on this phone
          </button>
        )}
        {failed && <p className="alert">Can't open storage on this phone.</p>}
        {runs?.length === 0 && <p className="note">No runs yet.</p>}
        {runs && runs.length > 0 && (
          <ul className="runs">
            {runs.map((r) => {
              const outcome = r.outcome ?? 'open'
              return (
                <li key={r.id}>
                  <a href={`#/run/${encodeURIComponent(r.id)}`}>
                    <span className="field">{r.field}</span>
                    <span className="date">{when.format(r.createdAt)}</span>
                    <span className={`chip ${outcome}`}>{OUTCOME_LABEL[outcome]}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </main>
      <footer className="actions">
        <a className="btn" href="#/new">
          New run
        </a>
      </footer>
    </div>
  )
}
