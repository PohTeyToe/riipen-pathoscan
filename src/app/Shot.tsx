import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { Region } from '../lib/find'
import { REACH_PX } from './reader'

export interface Ring {
  region: Region
  label: string
  tone?: 'pos' | 'neg' | 'held' | 'picked'
  /** With onRing: what Enter or Space on this ring does, read out to screen readers. */
  action?: string
}

interface Props {
  src?: string
  rings: Ring[]
  /** A tap on the photo, in image pixels, with a finger's reach in image pixels. */
  onTap?: (x: number, y: number, reach: number) => void
  /** Enter or Space on a ring: each ring is then a button in the tab order. */
  onRing?: (i: number) => void
  /** What a keyboard can't do here, for screen readers. */
  hint?: string
}

/** The run's photo with a numbered ring on each tube. */
export function Shot({ src, rings, onTap, onRing, hint }: Props) {
  const [size, setSize] = useState<{ src: string; w: number; h: number }>()
  const hintId = useId()
  const key = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onRing!(i)
  }
  const tap = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const k = size!.w / box.width
    onTap!((e.clientX - box.left) * k, (e.clientY - box.top) * k, REACH_PX * k)
  }
  // Sized to the photo's width, so labels stay about 18 CSS pixels whatever the photo's resolution.
  const font = size && size.w / 22
  return (
    <div className="shot">
      {src && <img src={src} alt="" onLoad={(e) => setSize({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
      {size?.src === src && font && (
        <svg
          viewBox={`0 0 ${size.w} ${size.h}`}
          fontSize={font}
          onClick={onTap && tap}
          role={onRing ? 'group' : 'img'}
          aria-label={`${rings.length} rings`}
          aria-describedby={hint ? hintId : undefined}
        >
          {rings.map(({ region: r, label, tone }, i) => {
            // An ellipse just outside the liquid's box, so rings on neighbouring tubes don't overlap.
            const rx = Math.max((r.x1 - r.x0) / 2 + font * 0.2, font * 0.4)
            const ry = Math.max((r.y1 - r.y0) / 2 + font * 0.2, font * 0.4)
            return (
              <g
                key={i}
                className={tone ? `ring ${tone}` : 'ring'}
                {...(onRing && { role: 'button', tabIndex: 0, 'aria-label': rings[i].action, onKeyDown: key(i) })}
              >
                <ellipse cx={(r.x0 + r.x1) / 2} cy={(r.y0 + r.y1) / 2} rx={rx} ry={ry} />
                <text x={(r.x0 + r.x1) / 2} y={(r.y0 + r.y1) / 2 - ry - font * 0.2}>
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      {hint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </div>
  )
}
