import { useEffect, useMemo, useState } from 'react'
import { QC } from '../lib/readers'
import { isWrong, listTubes, readRun, type RunView } from '../run'
import { callLights, Rack, type Light } from './Rack'

/**
 * The story run. The first weak-control seed (searching up from 1, at 5500 K, 0 stops and no pH shift) where
 * the midpoint rule makes two wrong calls, the calibrated reader makes none, and the control reads weaker
 * than three samples: the pattern measured in PathoScan's case-study photo. Captions are computed from it.
 */
export const STORY = { seed: 176, scenario: 'weak-pc' } as const
const COND = { kelvin: 5500, ev: 0, drift: 0 }
const BEAT_MS = 3600

export function storyFacts(v: RunView) {
  const samples = v.roles.flatMap((r, i) => (r === 'sample' ? [i] : []))
  const pc = v.roles.indexOf('pc')
  return {
    pc,
    brighter: samples.filter((i) => (v.calibrated.tubes[i].s ?? 0) > QC.weakControlS),
    midWrong: samples.filter((i) => isWrong('sample', v.midpoint.tubes[i].call, v.truth[i])),
    calWrong: samples.filter((i) => isWrong('sample', v.calibrated.tubes[i].call, v.truth[i])),
    calHeld: samples.filter((i) => v.calibrated.tubes[i].call === 'held'),
    weakFlag: v.calibrated.flags.some((f) => f.startsWith('The positive control is weaker')),
  }
}

export function Hero() {
  const view = useMemo(() => readRun(STORY.seed, STORY.scenario, COND), [])
  const f = useMemo(() => storyFacts(view), [view])
  const names = (idx: number[]) => listTubes(idx.map((i) => view.labels[i]))
  const [beat, setBeat] = useState(0)
  // With reduced motion the story waits for a tap instead of moving on by itself.
  const [playing, setPlaying] = useState(() => typeof matchMedia === 'undefined' || !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')

  // Play the story only while the tab is in front, so a page opened in a background tab still starts at beat one.
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  useEffect(() => {
    if (!playing || !visible) return
    if (beat >= 2) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setBeat((b) => b + 1), BEAT_MS)
    return () => clearTimeout(t)
  }, [beat, playing, visible])

  const choose = (k: number) => {
    setPlaying(false)
    setBeat(k)
  }
  const toggle = () => {
    if (playing) return setPlaying(false)
    if (beat === 2) setBeat(0)
    setPlaying(true)
  }

  const midN = f.midWrong.length
  const beats = [
    {
      title: 'Weak control',
      caption: (
        <>
          The positive control came out weak. Tubes {names(f.brighter)} read more yellow than it.
        </>
      ),
    },
    {
      title: 'Midpoint rule',
      caption: (
        <>
          A cut halfway between the controls calls {names(f.midWrong)} positive. {midN === 1 ? 'It is' : midN === 2 ? 'Both are' : 'All are'} negative.
        </>
      ),
    },
    {
      title: 'Tube Reader',
      caption: (
        <>
          {f.weakFlag ? 'It flags the control and holds ' : 'It holds '}
          {names(f.calHeld)} for a look by eye. {f.calWrong.length === 0 ? 'No wrong calls.' : `${f.calWrong.length} wrong.`}
        </>
      ),
    },
  ]

  const rows = useMemo(() => {
    if (beat === 0) {
      const lights: Light[] = view.labels.map((l, i) => {
        const raw = view.feats[i]?.raw
        const focus = i === f.pc || f.brighter.includes(i)
        return {
          show: 'swatch',
          swatch: raw ? `rgb(${raw.join(' ')})` : undefined,
          flag: i === f.pc,
          dim: !focus,
          aria: `${l}: ${i === f.pc ? 'positive control, weaker than some samples' : focus ? 'more yellow than the positive control' : 'colour as the camera saw it'}`,
        }
      })
      return [{ name: 'Colour as the camera saw it', lights }]
    }
    if (beat === 1) {
      const n = f.midWrong.length
      return [{ name: 'Midpoint rule', tally: `${n} wrong`, lights: callLights(view, view.midpoint) }]
    }
    const lights = callLights(view, view.calibrated).map((l, i) => (i === f.pc && f.weakFlag ? { ...l, flag: true, aria: 'PC: positive control, flagged as weaker than samples' } : l))
    return [{ name: 'Tube Reader', tally: `${f.calWrong.length} wrong · ${f.calHeld.length} held`, lights }]
  }, [beat, view, f])

  const ring = (i: number, cls: string) => {
    const c = view.centre[i]
    return <rect key={`${cls}${i}`} className={cls} x={c.x - 38} y={20} width={76} height={362} rx={16} />
  }
  const overlay =
    beat === 0 ? (
      <>
        <defs>
          <mask id="spot">
            <rect width={view.img.width} height={view.img.height} fill="white" />
            {[f.pc, ...f.brighter].map((i) => {
              const c = view.centre[i]
              return <rect key={i} x={c.x - 38} y={20} width={76} height={362} rx={16} fill="black" />
            })}
          </mask>
        </defs>
        <rect className="veil" width={view.img.width} height={view.img.height} mask="url(#spot)" />
        {ring(f.pc, 'ring ring-flag')}
        {f.brighter.map((i) => ring(i, 'ring'))}
      </>
    ) : beat === 1 ? (
      <>{f.midWrong.map((i) => ring(i, 'ring ring-wrong'))}</>
    ) : (
      <>
        {f.calHeld.map((i) => ring(i, 'ring ring-held'))}
        {f.weakFlag && ring(f.pc, 'ring ring-flag')}
      </>
    )

  return (
    <header className="hero">
      <div className="wrap hero-top">
        <span className="brand">
          Tube Reader <span className="brand-sub">for PathoBox LAMP runs</span>
        </span>
        <nav aria-label="Page">
          <a href="#lab">Lab</a>
          <a href="#bench">Real photos</a>
          <a href="https://github.com/PohTeyToe/riipen-pathoscan">Code</a>
        </nav>
      </div>
      <div className="wrap hero-grid">
        <h1>
          <span className="h1-a">A weak positive control fools a midpoint rule.</span> <span className="h1-b">This reader flags it.</span>
        </h1>
        <p className="hero-sub">It scores each tube against its own run's controls and holds in-between tubes for a look by eye.</p>
        <Rack
          view={view}
          tone="ultra"
          alt="Synthetic run of ten tubes on paper: a positive control that turned only orange, a negative control, and samples 1 to 8."
          overlay={overlay}
          rows={rows}
          sweep={beat}
        />
        <div className="story">
          <ol className="story-steps">
            {beats.map((b, k) => (
              <li key={k} className={k === beat ? 'on' : k < beat ? 'done' : ''}>
                <button type="button" aria-current={k === beat ? 'step' : undefined} onClick={() => choose(k)}>
                  <span className="story-n">{k + 1}</span>
                  <span className="story-t">{b.title}</span>
                  <span className="story-bar" aria-hidden>
                    <span key={`${beat}-${playing}-${visible}`} className={k === beat && playing && visible && beat < 2 ? 'run' : k < beat ? 'full' : ''} style={{ animationDuration: `${BEAT_MS}ms` }} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="story-caption" aria-live="polite">
            {beats[beat].caption}
          </p>
          <button type="button" className="story-play" onClick={toggle}>
            {playing ? 'Pause' : beat === 2 ? 'Play again' : 'Play'}
          </button>
        </div>
      </div>
    </header>
  )
}
