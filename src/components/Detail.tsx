import { useEffect, useRef } from 'react'
import { css } from '../lib/color'
import type { Features } from '../lib/find'
import type { Call, TubeRead } from '../lib/readers'
import type { Role, Truth } from '../lib/synth'

export interface TubeInfo {
  label: string
  role: Role
  feats: Features | null
  truth: Truth | null
  truthNote: string
}

const WORD: Record<Call, string> = { pos: 'Positive', neg: 'Negative', held: 'Held for a look' }
const GLYPH: Record<Call, string> = { pos: '+', neg: '−', held: '?' }
/** Degrees to one place, with a true minus sign. */
const deg = (x: number) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}°`
const ROLE: Record<Role, string> = { pc: 'Positive control', nc: 'Negative control', sample: 'Sample' }

interface Props {
  tube: TubeInfo
  naive: TubeRead
  calibrated: TubeRead
  midpoint: TubeRead
  onClose: () => void
  edit?: { setRole: (r: Role) => void; setTruth: (t: Truth | null) => void; remove: () => void } | null
}

/** One tube: what the camera saw, the colour once the paper beside it is made white, and what each rule did with it. */
export function Detail({ tube, naive, calibrated, midpoint, onClose, edit }: Props) {
  const f = tube.feats
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [tube.label])
  // Close hands focus back to whatever opened this tube: its light, its mark on the photo or the picker.
  const opener = useRef<HTMLElement | SVGElement | null>(null)
  useEffect(() => {
    const a = document.activeElement
    if ((a instanceof HTMLElement || a instanceof SVGElement) && a !== document.body && !ref.current?.contains(a)) opener.current = a
  }, [tube.label])
  const close = () => {
    const o = opener.current
    onClose()
    if (o?.isConnected) o.focus()
  }
  const sample = tube.role === 'sample'
  const row = (name: string, r: TubeRead) => (
    <div className="dt-read">
      <span className="dt-name">{name}</span>
      <span className={`dt-call ${sample ? r.call : 'ctrl'}`}>
        {sample ? (
          <>
            <span aria-hidden>{GLYPH[r.call]}</span> {WORD[r.call]}
          </>
        ) : (
          'Control'
        )}
      </span>
      {sample && tube.truth && r.call !== 'held' && r.call !== tube.truth && (
        <span className="dt-wrong">
          <span aria-hidden>×</span> wrong
        </span>
      )}
      <span className="dt-why">{r.reason}</span>
    </div>
  )
  return (
    <section className="detail" ref={ref} aria-label={`Tube ${tube.label}`}>
      <div className="dt-head">
        <h3>
          {tube.label} <span>{ROLE[tube.role]}</span>
        </h3>
        <button type="button" className="btn ghost" onClick={close}>
          Close
        </button>
      </div>
      <div className="dt-body">
        <div className="dt-swatches">
          <figure>
            <span className="dt-sw" style={{ background: f ? `rgb(${f.raw.join(' ')})` : undefined }} />
            <figcaption>
              Camera saw
              <b>{f ? `hue ${deg(f.rawHue)}` : 'no colour'}</b>
            </figcaption>
          </figure>
          <figure>
            <span className="dt-sw" style={{ background: f ? css(f.corrected) : undefined }} />
            <figcaption>
              Paper made white
              <b>{f ? `Lab hue ${deg(f.labHue)}` : '–'}</b>
            </figcaption>
          </figure>
        </div>
        <div className="dt-reads">
          {row('Fixed cut', naive)}
          {sample && row('Midpoint rule', midpoint)}
          {row('Tube Reader', calibrated)}
        </div>
        <dl className="dt-facts">
          <div>
            <dt>Truth</dt>
            <dd>{tube.truth ? `${tube.truth === 'pos' ? 'Positive' : 'Negative'}. ${tube.truthNote}` : tube.truthNote || 'Unknown'}</dd>
          </div>
          {calibrated.s !== undefined && (
            <div>
              <dt>Between controls</dt>
              <dd>
                {calibrated.s.toFixed(2)}
                {calibrated.p !== undefined && <> · p = {calibrated.p.toFixed(2)}</>}
              </dd>
            </div>
          )}
          {f && (
            <div>
              <dt>Pixels</dt>
              <dd>
                {f.clear} clear{f.glare ? `, ${f.glare} washed out` : ''} · paper {f.paperFrom === 'local' ? 'beside the tube' : 'from the whole photo'}
              </dd>
            </div>
          )}
        </dl>
      </div>
      {edit && (
        <div className="dt-edit">
          <div className="seg" role="group" aria-label="Role">
            {(['pc', 'nc', 'sample'] as const).map((r) => (
              <button key={r} type="button" aria-pressed={tube.role === r} onClick={() => edit.setRole(r)}>
                {ROLE[r]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="What it really was">
            {([null, 'pos', 'neg'] as const).map((t) => (
              <button key={String(t)} type="button" aria-pressed={tube.truth === t} onClick={() => edit.setTruth(t)}>
                {t === null ? 'Unknown' : t === 'pos' ? 'Really positive' : 'Really negative'}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost danger" onClick={edit.remove}>
            Remove
          </button>
        </div>
      )}
    </section>
  )
}
