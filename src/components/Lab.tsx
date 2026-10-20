import { useEffect, useMemo, useRef, useState } from 'react'
import evalData from '../../data/eval.json'
import { SCENARIOS, type ScenarioId } from '../lib/synth'
import { isWrong, KIND_WORD, readRun, type RunView } from '../run'
import { Detail } from './Detail'
import { callLights, Rack } from './Rack'
import { SweepChart, type SweepPoint } from './SweepChart'

/**
 * The lab's run. The first typical-run seed (searching up from 1, at 5500 K, 0 stops, no pH shift) whose read
 * matches the eval's per-run averages: one sample held, no calibrated mistakes, one fixed-cut mistake, no flags.
 */
export const LAB_SEED = 7

type Axis = 'drift' | 'kelvin' | 'ev'
const FIXED = evalData.setup.sweep.fixed
const AXES: { id: Axis; label: string; ends: [string, string]; fmt: (x: number) => string; tick: (x: number) => string }[] = [
  {
    id: 'drift',
    label: 'Run pH shift',
    ends: ['toward pink', 'toward yellow'],
    fmt: (x) => (x === 0 ? 'none' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`),
    tick: (x) => (x === 0 ? '0' : `${x > 0 ? '+' : '−'}${Math.abs(x)}`),
  },
  { id: 'kelvin', label: 'Light colour', ends: ['warm lamp', 'shade'], fmt: (x) => `${x} K`, tick: (x) => `${x / 1000}k K` },
  {
    id: 'ev',
    label: 'Exposure',
    ends: ['dark', 'blown out'],
    fmt: (x) => (x === 0 ? '0 stops' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} stops`),
    tick: (x) => (x === 0 ? '0' : `${x > 0 ? '+' : '−'}${Math.abs(x)}`),
  },
]
const SWEEPS = evalData.sweeps as Record<Axis, SweepPoint[]>
const home = (axis: Axis) => SWEEPS[axis].findIndex((p) => p.x === FIXED[axis])

/** Render work only once the section is near the screen, so the first paint is just the hero. */
function useNear<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near] as const
}

export function Lab() {
  const [ref, near] = useNear<HTMLElement>()
  const [axis, setAxis] = useState<Axis>('drift')
  const [idx, setIdx] = useState(home('drift'))
  const [scenario, setScenario] = useState<ScenarioId>('typical')
  const [seed, setSeed] = useState(LAB_SEED)
  const [selected, setSelected] = useState<number | null>(null)
  const A = AXES.find((a) => a.id === axis)!
  const points = SWEEPS[axis]
  const x = points[idx].x
  const cond = { ...FIXED, [axis]: x }

  const view = useMemo(() => (near ? readRun(seed, scenario, cond) : null), [near, seed, scenario, axis, x])
  useEffect(() => setSelected(null), [seed, scenario])

  const pickAxis = (a: Axis) => {
    setAxis(a)
    setIdx(home(a))
  }
  const p = points[idx]

  return (
    <section id="lab" className="lab" ref={ref} aria-labelledby="lab-h">
      <div className="wrap">
        <p className="eyebrow">Lab</p>
        <h2 id="lab-h">Light barely moves a fixed cut. A run-wide shift toward pink breaks it.</h2>
        <div className="lab-grid">
          <div className="lab-run">
            {view ? <LabRack view={view} selected={selected} onSelect={(i) => setSelected(selected === i ? null : i)} /> : <div className="rack-wait" />}
          </div>
          <div className="lab-controls">
            <div className="seg" role="group" aria-label="What to change">
              {AXES.map((a) => (
                <button key={a.id} type="button" aria-pressed={axis === a.id} onClick={() => pickAxis(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
            <div className="slider">
              <label htmlFor="lab-slider">
                <span>{A.label}</span>
                <output htmlFor="lab-slider">{A.fmt(x)}</output>
              </label>
              <input
                id="lab-slider"
                type="range"
                min={0}
                max={points.length - 1}
                step={1}
                value={idx}
                aria-valuetext={A.fmt(x)}
                onChange={(e) => setIdx(Number(e.target.value))}
              />
              <div className="slider-ends" aria-hidden>
                <span>{A.ends[0]}</span>
                <span>{A.ends[1]}</span>
              </div>
            </div>
            <div className="readout" aria-live="polite">
              <p className="readout-h">
                Eval at this setting ({A.fmt(x)}), per {p.naive.samples} synthetic samples
              </p>
              <ul>
                <li className="naive">
                  <b>{p.naive.wrong}</b> fixed cut wrong
                </li>
                <li className="cal">
                  <b>{p.calibrated.wrong}</b> Tube Reader wrong
                </li>
                <li className="held">
                  <b>{p.calibrated.held}</b> Tube Reader held
                </li>
              </ul>
            </div>
            <SweepChart points={points} at={idx} fmt={A.tick} label={A.label} />
            <p className="fine">
              {evalData.setup.sweep.runsPerPoint} runs per point, mixed scenarios, everything else at 5500 K, 0 stops and no shift.
              {axis === 'drift' && ' The shift moves every tube, controls included; how big it gets in real runs is my guess.'}
            </p>
          </div>
          <div className="chips" role="group" aria-label="Kind of run">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" className="chip" aria-pressed={scenario === s.id} onClick={() => setScenario(s.id)}>
                {s.label}
              </button>
            ))}
            <button type="button" className="chip new" onClick={() => setSeed((s) => (s * 48271 + 11) % 99991)}>
              New run
            </button>
          </div>

        </div>
        {view && selected !== null && (
          <Detail
            tube={{
              label: view.labels[selected],
              role: view.roles[selected],
              feats: view.feats[selected],
              truth: view.truth[selected],
              truthNote: `Synthetic ${KIND_WORD[view.kinds[selected]]}.`,
            }}
            naive={view.naive.tubes[selected]}
            midpoint={view.midpoint.tubes[selected]}
            calibrated={view.calibrated.tubes[selected]}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  )
}

function LabRack({ view, selected, onSelect }: { view: RunView; selected: number | null; onSelect: (i: number) => void }) {
  const count = (read: RunView['naive']) => {
    let wrong = 0
    let held = 0
    view.roles.forEach((r, i) => {
      if (r !== 'sample') return
      if (read.tubes[i].call === 'held') held++
      else if (isWrong(r, read.tubes[i].call, view.truth[i])) wrong++
    })
    return { wrong, held }
  }
  const n = count(view.naive)
  const c = count(view.calibrated)
  const flags = view.calibrated.flags
  return (
    <>
      <Rack
        view={view}
        alt="Synthetic run of ten tubes on paper: positive control, negative control and samples 1 to 8, drawn under the light and pH shift set by the slider."
        selected={selected}
        onSelect={onSelect}
        rows={[
          { name: 'Fixed cut', tally: <Tally {...n} />, lights: callLights(view, view.naive) },
          { name: 'Tube Reader', tally: <Tally {...c} />, lights: callLights(view, view.calibrated) },
        ]}
      />
      {flags.length > 0 && (
        <ul className="flags" aria-label="Tube Reader run checks">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </>
  )
}

const Tally = ({ wrong, held }: { wrong: number; held: number }) => (
  <>
    <b className={wrong ? 'bad' : ''}>{wrong} wrong</b>
    {held > 0 && <> · {held} held</>}
  </>
)
