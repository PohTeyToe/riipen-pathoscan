import { useEffect, useRef, useState } from 'react'
import type { Call } from '../lib/readers'
import type { Role } from '../lib/synth'

export interface StripDot {
  i: number
  x: number | null
  role: Role
  label: string
  call: Call
  wrong: boolean
}

interface Handle {
  value: number
  label: string
  min: number
  max: number
  onChange: (v: number) => void
}

interface Props {
  domain: [number, number]
  unit: string
  /** CSS gradient stops across the domain. */
  gradient: string
  ticks: { at: number; label: string }[]
  dots: StripDot[]
  handles: Handle[]
  /** Shaded spans, in domain units. */
  spans: { from: number; to: number; kind: Call }[]
  selected: number | null
  onSelect: (i: number) => void
  step: number
  label: string
}

/** A number line the reader's calls live on: every tube as a dot, the decision cut or band as handles. */
export function Strip({ domain, unit, gradient, ticks, dots, handles, spans, selected, onSelect, step, label }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [d0, d1] = domain
  const at = (v: number) => `${(((Math.min(d1, Math.max(d0, v)) - d0) / (d1 - d0)) * 100).toFixed(2)}%`
  const fromClient = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return d0 + ((clientX - r.left) / r.width) * (d1 - d0)
  }

  // Stack dots that would overlap into lanes, using their rendered width. Dense plates get small dots.
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dense = dots.length > 16
  const dotPx = dense ? 12 : 26
  const gap = ((dotPx + 2) / width) * (d1 - d0)
  const placed = dots
    .filter((d) => d.x !== null)
    .sort((a, b) => a.x! - b.x!)
    .reduce<{ dot: StripDot; lane: number }[]>((acc, dot) => {
      let lane = 0
      while (acc.some((p) => p.lane === lane && Math.abs(p.dot.x! - dot.x!) < gap)) lane++
      acc.push({ dot, lane })
      return acc
    }, [])
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1))
  const off = dots.filter((d) => d.x === null)

  return (
    <div className="strip" role="group" aria-label={label}>
      <div className={`strip-track${dense ? ' dense' : ''}`} ref={track} style={{ '--lanes': lanes } as React.CSSProperties}>
        <div className="strip-gradient" style={{ background: gradient }} />
        {spans.map((s, k) => (
          <div key={k} className={`strip-span ${s.kind}`} style={{ left: at(s.from), width: `calc(${at(s.to)} - ${at(s.from)})` }} />
        ))}
        {ticks.map((t) => (
          <div key={t.label} className="strip-tick" style={{ left: at(t.at) }}>
            <span>{t.label}</span>
          </div>
        ))}
        {placed.map(({ dot, lane }) => (
          <button
            key={dot.i}
            type="button"
            className={`dot ${dot.role} ${dot.call}${dot.wrong ? ' wrong' : ''}${selected === dot.i ? ' sel' : ''}`}
            style={{ left: at(dot.x!), '--lane': lane } as React.CSSProperties}
            onClick={() => onSelect(dot.i)}
            aria-label={`${dot.label}: ${dot.x!.toFixed(2)} ${unit}, ${dot.call === 'held' ? 'held' : dot.call === 'pos' ? 'positive' : 'negative'}`}
          >
            {!dense && <span>{dot.label}</span>}
          </button>
        ))}
        {handles.map((h, k) => (
          <div
            key={k}
            className="handle"
            role="slider"
            tabIndex={0}
            aria-label={h.label}
            aria-valuemin={h.min}
            aria-valuemax={h.max}
            aria-valuenow={+h.value.toFixed(3)}
            aria-valuetext={h.label}
            style={{ left: at(h.value) }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              e.preventDefault()
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
              h.onChange(Math.min(h.max, Math.max(h.min, fromClient(e.clientX))))
            }}
            onKeyDown={(e) => {
              const k2 = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
              if (!k2) return
              e.preventDefault()
              h.onChange(Math.min(h.max, Math.max(h.min, h.value + k2 * step * (e.shiftKey ? 5 : 1))))
            }}
          >
            <span className="handle-label">{h.label}</span>
          </div>
        ))}
      </div>
      {off.length > 0 && (
        <p className="strip-off">
          {off.length > 8 ? `${off.length} tubes aren't` : `Not`} on the scale{off.length > 8 ? '' : `: ${off.map((d) => d.label).join(', ')}`}. No reading;
          tap a tube to see why.
        </p>
      )}
    </div>
  )
}
