import { useEffect, useRef } from 'react'
import type { ViewTube } from '../App'
import { css } from '../lib/color'
import type { TubeRead } from '../lib/readers'
import type { Role, Truth } from '../lib/synth'

const WORD = { pos: 'Positive', neg: 'Negative', held: 'Held for a look' } as const
const ROLE: Record<Role, string> = { pc: 'Positive control', nc: 'Negative control', sample: 'Sample' }

interface Props {
  tube: ViewTube
  naive: TubeRead
  calibrated: TubeRead
  midpoint: TubeRead
  reader: 'naive' | 'calibrated'
  onClose: () => void
  edit: { setRole: (r: Role) => void; setTruth: (t: Truth | null) => void; remove: () => void } | null
}

/** Everything about one tube: what the camera saw, what each reader did with it, and why. */
export function Detail({ tube, naive, calibrated, midpoint, reader, onClose, edit }: Props) {
  const f = tube.feats
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [tube.label])
  const row = (name: string, r: TubeRead, on: boolean) => (
    <div className={`dr${on ? ' on' : ''}`}>
      <span className="dr-name">{name}</span>
      <span className={`call-word ${r.call}`}>{tube.role === 'sample' ? WORD[r.call] : 'Control'}</span>
      <span className="dr-why">{r.reason}</span>
    </div>
  )
  return (
    <section className="detail panel" ref={ref} aria-label={`Tube ${tube.label}`}>
      <div className="detail-head">
        <h2>
          {tube.label} <span className="muted">{ROLE[tube.role]}</span>
        </h2>
        <button className="btn" onClick={onClose} aria-label="Close tube details">
          Close
        </button>
      </div>
      <div className="detail-grid">
        <div className="swatches">
          <div>
            <span className="sw" style={{ background: f ? `rgb(${f.raw.join(' ')})` : 'transparent' }} />
            <span>As the camera saw it</span>
            <code>{f ? `hue ${f.rawHue.toFixed(1)}°` : 'no colour'}</code>
          </div>
          <div>
            <span className="sw" style={{ background: f ? css(f.corrected) : 'transparent' }} />
            <span>Paper made white</span>
            <code>{f ? `Lab hue ${f.labHue.toFixed(1)}°` : '-'}</code>
          </div>
        </div>
        <div className="reads">
          {row('Naive', naive, reader === 'naive')}
          {row('Calibrated', calibrated, reader === 'calibrated')}
          {tube.role === 'sample' && row('Midpoint rule', midpoint, false)}
          <p className="hint small">
            Midpoint rule: positive if the raw hue is past halfway between the two controls' raw hues. Shown for comparison only.
          </p>
        </div>
        <dl className="facts">
          <dt>Truth</dt>
          <dd>{tube.truth ? `${tube.truth === 'pos' ? 'Positive' : 'Negative'}. ${tube.truthNote}` : tube.truthNote || 'Unknown'}</dd>
          {calibrated.s !== undefined && (
            <>
              <dt>Between controls</dt>
              <dd>
                {calibrated.s.toFixed(2)} {calibrated.p !== undefined && <>· p = {calibrated.p.toFixed(2)}</>}
              </dd>
            </>
          )}
          {f && (
            <>
              <dt>Pixels</dt>
              <dd>
                {f.clear} clear{f.glare ? `, ${f.glare} washed out` : ''} · paper reference {f.paperFrom === 'local' ? 'beside the tube' : 'whole photo'}
              </dd>
              <dt>Lab</dt>
              <dd>
                L {f.lab.L.toFixed(0)} · a {f.lab.a.toFixed(1)} · b {f.lab.b.toFixed(1)}
              </dd>
            </>
          )}
        </dl>
      </div>
      {edit && (
        <div className="edit">
          <div className="seg small" role="radiogroup" aria-label="Role">
            {(['pc', 'nc', 'sample'] as const).map((r) => (
              <button key={r} role="radio" aria-checked={tube.role === r} className={tube.role === r ? 'on' : ''} onClick={() => edit.setRole(r)}>
                {ROLE[r]}
              </button>
            ))}
          </div>
          <div className="seg small" role="radiogroup" aria-label="What it really was">
            {([null, 'pos', 'neg'] as const).map((t) => (
              <button key={String(t)} role="radio" aria-checked={tube.truth === t} className={tube.truth === t ? 'on' : ''} onClick={() => edit.setTruth(t)}>
                {t === null ? 'Unknown' : t === 'pos' ? 'Really positive' : 'Really negative'}
              </button>
            ))}
          </div>
          <button className="btn danger" onClick={edit.remove}>
            Remove
          </button>
        </div>
      )}
    </section>
  )
}
