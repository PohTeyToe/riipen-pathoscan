import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { assays } from './assays'
import type { Step } from './assays/assay'
import { Photo } from './Photo'
import { Result } from './Result'
import { currentStep, type Run } from './run'
import { getRun, setStepDone, startTimer } from './store'
import { clock, remainingMs, sessionClock, type SessionClock } from './timer'
import { Action, Bar } from './ui'
import { useUpdate } from './update'
import { useOnVisible } from './visible'

export function Guide({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>()
  const [failed, setFailed] = useState(false)
  const [time] = useState(sessionClock)
  const update = useUpdate()
  const load = useCallback(() => void getRun(id).then((r) => setRun(r ?? null), () => setFailed(true)), [id])
  useEffect(load, [load])
  useOnVisible(
    useCallback(() => {
      time.resync()
      load()
    }, [time, load]),
  )

  const assay = run && assays[run.assay]
  if (!run || !assay) {
    const missing = run === null || failed || (run && !assay)
    return (
      <div className="screen">
        <Bar />
        {/* A run only a newer version can open shows as missing here, with Reload offered above. */}
        <main className="body">{missing && <p className="alert">{update ? 'Reload to open this run.' : 'Run not found.'}</p>}</main>
      </div>
    )
  }

  // Each tap writes only its own change, then shows the run as stored, which may include another tab's progress.
  const act = async (write: () => Promise<void>) => {
    try {
      await write()
      setRun((await getRun(id)) ?? null)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const i = currentStep(run, assay)
  const prev = assay.steps[(i === -1 ? assay.steps.length : i) - 1]
  const back = prev && (
    <Action ghost onClick={() => act(() => setStepDone(id, prev.id, false))}>
      Back
    </Action>
  )
  const error = failed && <p className="alert">Couldn't save. Try again.</p>

  if (run.read) return <Result run={run} assay={assay} act={act} error={error} />
  if (i === -1) return <Photo key={run.photoKey} run={run} assay={assay} act={act} back={back} error={error} />
  const step = assay.steps[i]

  return (
    <div className="screen">
      <Bar field={run.field} step={`Step ${i + 1} of ${assay.steps.length}`} />
      <StepView
        key={step.id}
        step={step}
        startedAt={run.steps[step.id]?.timerStartedAt}
        time={time}
        onStart={() => act(() => startTimer(id, step.id, time.now()))}
        onDone={() => act(() => setStepDone(id, step.id, true))}
        back={back}
        error={error}
      />
    </div>
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
        {step.image && <img className="picture" src={step.image.src} alt={step.image.alt} />}
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
