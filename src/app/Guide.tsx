import { useEffect, useState, type ReactNode } from 'react'
import { assays } from './assays'
import type { Step } from './assays/assay'
import { currentStep, withStep, type Run } from './run'
import { getRun, saveRun } from './store'
import { clock, remainingMs, sessionClock, type SessionClock } from './timer'

export function Guide({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>()
  const [failed, setFailed] = useState(false)
  const [time] = useState(sessionClock)
  useEffect(() => {
    getRun(id).then((r) => setRun(r ?? null), () => setFailed(true))
  }, [id])
  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && time.resync()
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [time])

  const assay = run && assays[run.assay]
  if (!run || !assay) {
    const missing = run === null || failed || (run && !assay)
    return (
      <div className="screen">
        <Bar />
        <main className="body">{missing && <p className="alert">Run not found.</p>}</main>
      </div>
    )
  }

  const update = async (next: Run) => {
    try {
      await saveRun(next)
      setRun(next)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const i = currentStep(run)
  const prev = (i === -1 ? run.steps.length : i) - 1
  const back = prev >= 0 && (
    <Action ghost onClick={() => update(withStep(run, prev, { done: false }))}>
      Back
    </Action>
  )
  const error = failed && <p className="alert">Couldn't save. Try again.</p>

  if (i === -1) {
    return (
      <div className="screen">
        <Bar field={run.field} />
        <main className="body">
          <h1>Take photo</h1>
          <p className="note">Coming in the next build.</p>
          {error}
        </main>
        <footer className="actions">
          {back}
          <button type="button" className="btn" disabled>
            Take photo
          </button>
        </footer>
      </div>
    )
  }

  return (
    <div className="screen">
      <Bar field={run.field} step={`Step ${i + 1} of ${run.steps.length}`} />
      <StepView
        key={i}
        step={assay.steps[i]}
        startedAt={run.steps[i].timerStartedAt}
        time={time}
        onStart={() => update(withStep(run, i, { timerStartedAt: time.now() }))}
        onDone={() => update(withStep(run, i, { done: true }))}
        back={back}
        error={error}
      />
    </div>
  )
}

function Bar({ field, step }: { field?: string; step?: string }) {
  return (
    <header className="bar">
      <a className="back" href="#/">
        ‹ Runs
      </a>
      {field && (
        <span className="where">
          <span className="field">{field}</span>
          {step}
        </span>
      )}
    </header>
  )
}

interface StepProps {
  step: Step
  startedAt?: number
  time: SessionClock
  onStart: () => void
  onDone: () => void
  back: ReactNode
  error: ReactNode
}

/** One step. A timed step starts with Start timer; after that, and on every other step, the one action is Done. */
function StepView({ step, startedAt, time, onStart, onDone, back, error }: StepProps) {
  const now = useNow(time, step.timerMin !== undefined && startedAt !== undefined)
  const left = step.timerMin === undefined ? 0 : startedAt === undefined ? step.timerMin * 60_000 : remainingMs(startedAt, step.timerMin, now)

  return (
    <>
      <main className="body">
        <h1>{step.title}</h1>
        <p className="lead">{step.body}</p>
        {step.timerMin !== undefined && (
          <>
            <p className={left === 0 ? 'timer up' : 'timer'} role="timer">
              {left === 0 ? "Time's up" : clock(left)}
            </p>
            <p className="note">Set your phone's alarm too.</p>
          </>
        )}
        {error}
      </main>
      <footer className="actions">
        {back}
        {step.timerMin !== undefined && startedAt === undefined ? (
          <Action key="start" onClick={onStart}>
            Start timer
          </Action>
        ) : (
          <Action key="done" onClick={onDone}>
            Done
          </Action>
        )}
      </footer>
    </>
  )
}

/** A button that takes no taps for its first half second, so a double tap can't also finish the next step. */
function Action({ onClick, ghost, children }: { onClick: () => void; ghost?: boolean; children: ReactNode }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 500)
    return () => clearTimeout(t)
  }, [])
  return (
    <button type="button" className={ghost ? 'btn ghost' : 'btn'} data-arming={armed ? undefined : ''} disabled={!armed} onClick={onClick}>
      {children}
    </button>
  )
}

/** The session clock's time, refreshed every second while `ticking`. */
function useNow(time: SessionClock, ticking: boolean) {
  const [now, setNow] = useState(time.now)
  useEffect(() => {
    if (!ticking) return
    setNow(time.now())
    const t = setInterval(() => setNow(time.now()), 1000)
    return () => clearInterval(t)
  }, [time, ticking])
  return now
}
