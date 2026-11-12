import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Region } from '../lib/find'
import { loadImage } from '../lib/photo'
import type { Img } from '../lib/synth'
import type { Assay } from './assays/assay'
import { encodePhoto } from './camera'
import { findRings, readTubes, ringAt, rolesFrom, tapRings } from './reader'
import type { Run } from './run'
import { Shot } from './Shot'
import { getPhoto, saveRead, savePhoto, setPhoto } from './store'
import { Bar } from './ui'

interface Props {
  run: Run
  assay: Assay
  act: (write: () => Promise<void>) => Promise<void>
  back: ReactNode
  error: ReactNode
}

/** Take the photo, fix the rings, tap the two controls. The last tap reads the run and saves it. */
export function Photo({ run, assay, act, back, error }: Props) {
  const [shot, setShot] = useState<{ url: string; img: Img }>()
  const [rings, setRings] = useState<Region[]>([])
  const [stage, setStage] = useState<'rings' | 'pc' | 'nc'>('rings')
  const [pc, setPc] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState(false)
  const latest = useRef(0)

  // Always from the saved file, so a reload or a reread sees the same pixels.
  const show = useCallback(async (key: string) => {
    const n = ++latest.current
    const blob = await getPhoto(key)
    if (!blob) throw new Error('No saved photo')
    const img = await loadImage(blob)
    if (n !== latest.current) return
    setShot({ url: URL.createObjectURL(blob), img })
    setRings(findRings(img))
    setStage('rings')
  }, [])
  useEffect(() => {
    // Only on opening: later photos come through take().
    if (run.photoKey) show(run.photoKey).catch(() => setBad(true))
  }, [])
  useEffect(() => {
    if (shot) return () => URL.revokeObjectURL(shot.url)
  }, [shot])

  const take = async (file: File) => {
    setBusy(true)
    setBad(false)
    try {
      await savePhoto(run.id, await encodePhoto(file))
      await setPhoto(run.id, run.id)
      await show(run.id)
    } catch {
      setBad(true)
    }
    setBusy(false)
  }

  const tap = (x: number, y: number, reach: number) => {
    if (stage === 'rings') return setRings(tapRings(rings, x, y, reach))
    const i = ringAt(rings, x, y, reach)
    if (i < 0) return
    if (stage === 'pc') {
      setPc(i)
      setStage('nc')
    } else if (i !== pc) {
      const roles = rolesFrom(rings.length, pc, i)
      void act(() => saveRead(run.id, rings, roles, readTubes(shot!.img, rings, roles), assay.treatAt))
    }
  }

  const camera = (label: string, ghost?: boolean) => (
    <label className={ghost ? 'btn ghost camera' : 'btn camera'}>
      {busy ? 'Reading…' : label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void take(file)
        }}
      />
    </label>
  )
  const status = bad && <p className="alert">Couldn't read that photo. Take it again.</p>

  if (!shot)
    return (
      <div className="screen">
        <Bar field={run.field} step="Photo" />
        <main className="body">
          <h1>Take photo</h1>
          <p className="lead">All 10 tubes on white paper, in shade.</p>
          {status}
          {error}
        </main>
        <footer className="actions">
          {back}
          {camera('Take photo')}
        </footer>
      </div>
    )

  const n = rings.length
  const labels = rings.map((region, i) => ({ region, label: i === pc && stage === 'nc' ? '+' : String(i + 1), tone: i === pc && stage === 'nc' ? ('picked' as const) : undefined }))
  return (
    <div className="screen">
      <Bar field={run.field} step="Photo" />
      <main className="body">
        <h1>{stage === 'rings' ? (n === assay.tubes ? `${n} tubes` : `${n} of ${assay.tubes} tubes`) : stage === 'pc' ? 'Tap the positive control' : 'Tap the negative control'}</h1>
        {stage === 'rings' && <p className="note">Tap a tube to ring it. Tap a ring to remove it.</p>}
        <Shot src={shot.url} rings={labels} onTap={tap} />
        {status}
        {error}
      </main>
      <footer className="actions">
        {stage === 'rings' ? (
          <>
            {camera('Retake', true)}
            <button type="button" className="btn" disabled={n !== assay.tubes} onClick={() => setStage('pc')}>
              Continue
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost" onClick={() => (setPc(-1), setStage(stage === 'nc' ? 'pc' : 'rings'))}>
            Back
          </button>
        )}
      </footer>
    </div>
  )
}
