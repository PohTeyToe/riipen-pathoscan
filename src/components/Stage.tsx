import { useEffect, useRef } from 'react'
import type { Region } from '../lib/find'
import { draw } from '../lib/photo'
import type { Call } from '../lib/readers'
import type { Img, Role } from '../lib/synth'

export interface StageTube {
  region: Region | null
  /** Where to put the label when nothing was found (synthetic tubes only). */
  anchor: { x: number; y: number }
  label: string
  role: Role
  call: Call
  /** Undefined when truth isn't known. */
  wrong?: boolean
}

const CALL_WORD: Record<Call, string> = { pos: 'Pos', neg: 'Neg', held: 'Look' }

interface Props {
  img: Img
  tubes: StageTube[]
  selected: number | null
  onSelect: (i: number | null) => void
  /** Chips under each tube, for the synthetic row of ten. */
  chips: boolean
  placing: boolean
  onPlace?: (x: number, y: number) => void
  alt: string
}

export function Stage({ img, tubes, selected, onSelect, chips, placing, onPlace, alt }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) draw(canvas.current, img)
  }, [img])
  const stroke = Math.max(2, img.width / 400)
  const labels = tubes.length <= 16

  return (
    <div className="stage">
      <div className={`stage-img${placing ? ' placing' : ''}${chips ? ' fill' : ''}`}>
        <canvas ref={canvas} role="img" aria-label={alt} />
        <svg
          viewBox={`0 0 ${img.width} ${img.height}`}
          className="overlay"
          onClick={(e) => {
            if (!placing || !onPlace) return
            const r = e.currentTarget.getBoundingClientRect()
            onPlace(((e.clientX - r.left) / r.width) * img.width, ((e.clientY - r.top) / r.height) * img.height)
          }}
        >
          {tubes.map((t, i) => {
            const sel = selected === i
            const cls = `mark ${t.call}${t.wrong ? ' wrong' : ''}${sel ? ' sel' : ''}`
            const r = t.region
            const pad = stroke * 2
            const shape = !r ? null : r.r !== undefined ? (
              <circle cx={r.cx} cy={r.cy} r={r.r + pad} />
            ) : (
              <rect x={r.x0 - pad} y={r.y0 - pad} width={r.x1 - r.x0 + 2 * pad} height={r.y1 - r.y0 + 2 * pad} rx={stroke * 2} />
            )
            const ly = r ? (r.r !== undefined ? r.cy - r.r - pad * 2 : r.y0 - pad * 2) : t.anchor.y
            return (
              <g
                key={i}
                className={cls}
                style={{ strokeWidth: sel ? stroke * 1.8 : stroke }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(sel ? null : i)
                }}
                role="button"
                tabIndex={labels ? 0 : -1}
                aria-label={`${t.label}: ${t.role === 'sample' ? CALL_WORD[t.call] : 'control'}`}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onSelect(sel ? null : i)
                }}
              >
                {shape}
                {(labels || sel) && !chips && (
                  <text x={r?.cx ?? t.anchor.x} y={ly} fontSize={Math.max(12, img.width / 50)} textAnchor="middle">
                    {t.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {!chips && tubes.length > 0 && (
        <div className="pick">
          <span aria-hidden>Inspect a tube</span>
          <select aria-label="Inspect a tube" value={selected ?? ''} onChange={(e) => onSelect(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Choose…</option>
            {tubes.map((t, i) => (
              <option key={i} value={i}>
                {t.label}: {t.role === 'sample' ? CALL_WORD[t.call] : t.role === 'pc' ? 'positive control' : 'negative control'}
                {t.wrong ? ' (wrong)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {chips && (
        <div className="chips" aria-label="Calls">
          {tubes.map((t, i) => (
            <button
              key={i}
              type="button"
              className={`chip ${t.call}${t.wrong ? ' wrong' : ''}${selected === i ? ' sel' : ''}${t.role !== 'sample' ? ' control' : ''}`}
              style={{ left: `${((t.region?.cx ?? t.anchor.x) / img.width) * 100}%` }}
              onClick={() => onSelect(selected === i ? null : i)}
              aria-pressed={selected === i}
            >
              <span className="chip-label">{t.label}</span>
              <span className="chip-call">{t.role === 'sample' ? CALL_WORD[t.call] : t.role === 'pc' ? 'ctrl +' : 'ctrl −'}</span>
              {t.wrong && <span className="chip-wrong">wrong</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
