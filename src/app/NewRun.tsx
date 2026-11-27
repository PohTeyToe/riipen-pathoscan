import { useState, type FormEvent } from 'react'
import { assays } from './assays'
import { newRun, type Run } from './run'
import { addRun, askPersist } from './store'

const canLocate = 'geolocation' in navigator

export function NewRun() {
  const [test, setTest] = useState(Object.keys(assays)[0])
  const [field, setField] = useState('')
  const [notes, setNotes] = useState('')
  const [gps, setGps] = useState<Run['gps']>()
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const locate = () => {
    setLocating('busy')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGps({ lat: coords.latitude, lon: coords.longitude, acc: Math.round(coords.accuracy) })
        setLocating('idle')
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
    )
  }

  const start = async (e: FormEvent) => {
    e.preventDefault()
    if (!field.trim() || saving) return
    setSaving(true)
    const run = newRun(assays[test], { field, notes, gps })
    try {
      await addRun(run)
      void askPersist().catch(() => {})
      location.replace(`#/run/${encodeURIComponent(run.id)}`)
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  return (
    <form className="screen" onSubmit={start}>
      <header className="bar">
        <a className="back" href="#/">
          ‹ Runs
        </a>
      </header>
      <main className="body">
        <h1>New run</h1>
        <fieldset className="choice">
          <legend>Test</legend>
          {Object.values(assays).map((a) => (
            <label key={a.id}>
              <input type="radio" name="test" value={a.id} checked={test === a.id} onChange={() => setTest(a.id)} />
              <span>
                {a.name}
                {a.note && <small>{a.note}</small>}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="input">
          <span>Field name</span>
          <input value={field} onChange={(e) => setField(e.target.value)} required autoComplete="off" enterKeyHint="done" />
        </label>
        <label className="input">
          <span>Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {canLocate &&
          (gps ? (
            <p className="gps">
              <span>
                {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)} ±{gps.acc} m
              </span>
              <button type="button" className="link" onClick={() => setGps(undefined)}>
                Remove
              </button>
            </p>
          ) : (
            <button type="button" className="btn ghost" onClick={locate} disabled={locating === 'busy'}>
              {locating === 'busy' ? 'Finding location…' : locating === 'failed' ? 'No location. Try again' : 'Add location'}
            </button>
          ))}
        {failed && <p className="alert">Couldn't save. Try again.</p>}
      </main>
      <footer className="actions">
        <button className="btn" disabled={!field.trim() || saving}>
          Start run
        </button>
      </footer>
    </form>
  )
}
