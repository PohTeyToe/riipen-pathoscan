import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { draw } from '../lib/photo'
import type { Call } from '../lib/readers'
import type { RunView } from '../run'

/** What one light under a tube shows: a call, the colour the reader measured, or nothing yet. */
export interface Light {
  show: Call | 'swatch' | 'ctrl' | 'off'
  wrong?: boolean
  /** A run check points at this tube (the weak positive control). */
  flag?: boolean
  /** Not part of the point being made right now. */
  dim?: boolean
  swatch?: string
  /** Spoken name of the light, e.g. "Tube 4: positive, wrong". */
  aria: string
}

export interface LightRow {
  name?: string
  tally?: ReactNode
  lights: Light[]
}

const GLYPH: Record<Light['show'], string> = { pos: '+', neg: '−', held: '?', swatch: '', ctrl: '', off: '' }
const WORD: Record<Light['show'], string> = { pos: 'pos', neg: 'neg', held: 'look', swatch: '', ctrl: '', off: '' }

interface Props {
  view: RunView
  alt: string
  /** SVG drawn over the photo, in image pixels. */
  overlay?: ReactNode
  rows: LightRow[]
  /** Changing it replays the read: a sweep across the tubes and the lights coming on in turn. */
  sweep?: string | number
  selected?: number | null
  onSelect?: (i: number) => void
  tone?: 'ultra' | 'paper'
}

/** A run of tubes on paper, labelled by hand like a real run, with a row of lights under each tube per reader. */
export function Rack({ view, alt, overlay, rows, sweep, selected, onSelect, tone = 'paper' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) draw(canvas.current, view.img)
  }, [view.img])
  // Each row of lights is one tab stop, on this tube; the arrow keys and clicks move it.
  const [stop, setStop] = useState(selected ?? 0)
  const rove = (e: KeyboardEvent<HTMLOListElement>) => {
    const n = view.labels.length
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : step ? Math.min(n - 1, Math.max(0, stop + step)) : -1
    if (to < 0) return
    e.preventDefault()
    setStop(to)
    e.currentTarget.querySelectorAll('button')[to]?.focus()
  }

  return (
    <figure className={`rack rack-${tone}`}>
      <div className="rack-photo">
        <canvas ref={canvas} role="img" aria-label={alt} />
        <svg className="rack-overlay" viewBox={`0 0 ${view.img.width} ${view.img.height}`} aria-hidden>
          {overlay}
        </svg>
        <div className="rack-hand" aria-hidden>
          {view.labels.map((l, i) => (
            <span key={i} style={{ left: `${view.x[i] * 100}%` }}>
              {l}
            </span>
          ))}
        </div>
        {sweep !== undefined && <div key={sweep} className="rack-sweep" aria-hidden />}
      </div>
      {rows.map((row, r) => (
        <div className="lights-row" key={r}>
          {(row.name || row.tally) && (
            <div className="lights-head">
              {row.name && <span className="lights-name">{row.name}</span>}
              {row.tally && <span className="lights-tally">{row.tally}</span>}
            </div>
          )}
          <ol className="lights" aria-label={row.name ? `${row.name} calls` : 'Calls'} onKeyDown={onSelect ? rove : undefined}>
            {row.lights.map((l, i) => {
              const cls = `light ${l.show}${l.wrong ? ' wrong' : ''}${l.flag ? ' flag' : ''}${l.dim ? ' dim' : ''}${selected === i ? ' sel' : ''}`
              const body = (
                <>
                  <span className="light-glyph" style={l.swatch ? { background: l.swatch } : undefined}>
                    {l.show === 'ctrl' ? view.labels[i] : GLYPH[l.show]}
                  </span>
                  {WORD[l.show] && <span className="light-word">{WORD[l.show]}</span>}
                  {l.wrong && <span className="light-x">×</span>}
                  {l.flag && <span className="light-flag">!</span>}
                </>
              )
              return (
                <li
                  key={`${i}-${l.show}-${l.wrong ? 1 : 0}`}
                  className={cls}
                  style={{ left: `${view.x[i] * 100}%`, '--i': sweep === undefined ? 0 : i } as React.CSSProperties}
                >
                  {onSelect ? (
                    <button
                      type="button"
                      tabIndex={i === stop ? 0 : -1}
                      aria-label={l.aria}
                      aria-pressed={selected === i}
                      onClick={() => (setStop(i), onSelect(i))}
                      onFocus={() => setStop(i)}
                    >
                      {body}
                    </button>
                  ) : (
                    <span className="light-body" role="img" aria-label={l.aria}>
                      {body}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      <figcaption className="rack-cap">Synthetic run, drawn by code</figcaption>
    </figure>
  )
}

const WORDS: Record<Call, string> = { pos: 'positive', neg: 'negative', held: 'held for a look' }

/** Lights for one reader's calls on a run: controls stay quiet, samples show the call and whether it's wrong. */
export function callLights(view: RunView, read: RunView['naive']): Light[] {
  return view.labels.map((label, i) => {
    const role = view.roles[i]
    if (role !== 'sample') return { show: 'ctrl', aria: `${label}: ${role === 'pc' ? 'positive' : 'negative'} control` }
    const call = read.tubes[i].call
    const wrong = call !== 'held' && call !== view.truth[i]
    return { show: call, wrong, aria: `Tube ${label}: ${WORDS[call]}${wrong ? ', wrong' : ''}` }
  })
}
