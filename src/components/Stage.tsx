import { useEffect, useRef } from 'react'
import type { Region } from '../lib/find'
import { draw } from '../lib/photo'
import type { Call } from '../lib/readers'
import type { Img, Role } from '../lib/synth'

export interface StageTube {
  region: Region
  label: string
  role: Role
  call: Call
  /** Undefined when the truth isn't known. */
  wrong?: boolean
}

const CALL_WORD: Record<Call, string> = { pos: 'positive', neg: 'negative', held: 'held for a look' }

interface Props {
  img: Img
  tubes: StageTube[]
  selected: number | null
  onSelect: (i: number | null) => void
  placing: boolean
  onPlace?: (x: number, y: number) => void
  alt: string
}

/** A photo with a mark on every tube or well the reader read. Marks are focusable when there are few of them; a picker lists them all. */
export function Stage({ img, tubes, selected, onSelect, placing, onPlace, alt }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) draw(canvas.current, img)
  }, [img])
  const stroke = Math.max(2, img.width / 380)
  const few = tubes.length <= 16
  const word = (t: StageTube) => (t.role === 'sample' ? CALL_WORD[t.call] : t.role === 'pc' ? 'positive control' : 'negative control')

  return (
    <div className="stage">
      <div className={`stage-img${placing ? ' placing' : ''}`}>
        <canvas ref={canvas} role="img" aria-label={alt} />
        <svg
          viewBox={`0 0 ${img.width} ${img.height}`}
          className="stage-overlay"
          onClick={(e) => {
            if (!placing || !onPlace) return
            const r = e.currentTarget.getBoundingClientRect()
            onPlace(((e.clientX - r.left) / r.width) * img.width, ((e.clientY - r.top) / r.height) * img.height)
          }}
        >
          {tubes.map((t, i) => {
            const sel = selected === i
            const r = t.region
            const pad = stroke * 2
            const shape =
              r.r !== undefined ? (
                <circle cx={r.cx} cy={r.cy} r={r.r + pad} />
              ) : (
                <rect x={r.x0 - pad} y={r.y0 - pad} width={r.x1 - r.x0 + 2 * pad} height={r.y1 - r.y0 + 2 * pad} rx={stroke * 2} />
              )
            const ly = r.r !== undefined ? r.cy - r.r - pad * 2 : r.y0 - pad * 2
            return (
              <g
                key={i}
                className={`mark ${t.role === 'sample' ? t.call : 'ctrl'}${t.wrong ? ' wrong' : ''}${sel ? ' sel' : ''}`}
                style={{ strokeWidth: sel ? stroke * 1.8 : stroke }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(sel ? null : i)
                }}
                role="button"
                tabIndex={few ? 0 : -1}
                aria-label={`${t.label}: ${word(t)}${t.wrong ? ', wrong' : ''}`}
                aria-pressed={sel}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onSelect(sel ? null : i)
                }}
              >
                {shape}
                {(few || sel) && (
                  <text x={r.cx} y={ly} fontSize={Math.max(12, img.width / 48)} textAnchor="middle">
                    {t.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {tubes.length > 0 && (
        <label className="pick">
          <span>Inspect a tube</span>
          <select value={selected ?? ''} onChange={(e) => onSelect(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Choose…</option>
            {tubes.map((t, i) => (
              <option key={i} value={i}>
                {t.label}: {word(t)}
                {t.wrong ? ' (wrong)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
