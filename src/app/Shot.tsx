import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Region } from '../lib/find'
import { labelSize, REACH_PX, ringShape } from './reader'

export interface Ring {
  region: Region
  label: string
  tone?: 'pos' | 'neg' | 'held' | 'picked'
  /** With onRing: what choosing this ring does, read out to screen readers. */
  action?: string
}

interface Props {
  src?: string
  rings: Ring[]
  /** A tap on the photo, in image pixels, with a finger's reach in image pixels. */
  onTap?: (x: number, y: number, reach: number) => void
  /** A ring chosen: each ring is then a button, for a finger, a key or assistive tech. */
  onRing?: (i: number) => void
  /** What a keyboard can't do here, for screen readers. */
  hint?: string
}

/** The run's photo with a numbered ring on each tube. */
export function Shot({ src, rings, onTap, onRing, hint }: Props) {
  const [size, setSize] = useState<{ src: string; w: number; h: number }>()
  const hintId = useId()
  const group = useRef<HTMLDivElement>(null)
  const chosen = useRef<number | null>(null)
  // A ring removed from the keyboard takes focus with it: move it to the next ring, the one before if it
  // was the last, or the photo.
  useLayoutEffect(() => {
    const i = chosen.current
    chosen.current = null
    const g = group.current
    if (i === null || !g || g.contains(document.activeElement)) return
    const buttons = g.querySelectorAll('button')
    ;(buttons[Math.min(i, buttons.length - 1)] ?? g).focus()
  }, [rings])
  const tap = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const k = size!.w / box.width
    onTap!((e.clientX - box.left) * k, (e.clientY - box.top) * k, REACH_PX * k)
  }
  const font = size && size.src === src ? labelSize(size.w) : undefined
  const ellipse = (r: Region) => ringShape(r, size!.w)
  const pct = (v: number, of: number) => `${(100 * v) / of}%`
  return (
    <div className="shot" style={font ? ({ '--ratio': size!.w / size!.h } as CSSProperties) : undefined}>
      <div className="frame">
        {src && <img src={src} alt="" onLoad={(e) => setSize({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        {size && font && (
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            fontSize={font}
            onClick={onTap && tap}
            {...(onRing ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${rings.length} rings` })}
          >
            {rings.map(({ region, label, tone }, i) => {
              const e = ellipse(region)
              return (
                <g key={i} className={tone ? `ring ${tone}` : 'ring'}>
                  <ellipse {...e} />
                  <text x={e.cx} y={e.cy - e.ry - font * 0.2}>
                    {label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
        {size && font && onRing && (
          <div ref={group} className="hits" role="group" aria-label={`${rings.length} rings`} aria-describedby={hint ? hintId : undefined} tabIndex={-1}>
            {rings.map(({ region, action }, i) => {
              const e = ellipse(region)
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={action}
                  style={{ left: pct(e.cx - e.rx, size.w), top: pct(e.cy - e.ry, size.h), width: pct(2 * e.rx, size.w), height: pct(2 * e.ry, size.h) }}
                  onClick={(ev) => {
                    ev.stopPropagation() // a ring chosen is never also a tap on the photo
                    chosen.current = i
                    onRing(i)
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
      {hint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </div>
  )
}
