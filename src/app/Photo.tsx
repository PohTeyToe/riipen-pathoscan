import { useEffect, useState, type ReactNode } from 'react'
import type { Region } from '../lib/find'
import { loadImage } from '../lib/photo'
import type { Img } from '../lib/synth'
import type { Assay } from './assays/assay'
import { encodePhoto } from './camera'
import { addRing, findRings, pcAtEnd, readTubes, removeRing, ringAt, rolesFrom } from './reader'
import type { Run } from './run'
import { Shot } from './Shot'
import { getPhoto, saveRead, takePhoto } from './store'
import { Bar } from './ui'

interface Props {
  run: Run
  assay: Assay
  act: (write: () => Promise<void>) => Promise<void>
  back: ReactNode
  error: ReactNode
}

/**
 * Take the photo, fix the rings, tap the two controls. The last tap reads the run and saves it. Guide gives
 * each stored photo its own instance of this screen, so the rings on show are always the stored photo's.
 */
export function Photo({ run, assay, act, back, error }: Props) {
  const [shot, setShot] = useState<{ url: string; img: Img }>()
  const [rings, setRings] = useState<Region[]>([])
  const [stage, setStage] = useState<'rings' | 'pc' | 'nc'>('rings')
  const [pc, setPc] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState(false)
  const [notEnd, setNotEnd] = useState(false)

  // Always from the saved file, so a reload or a reread sees the same pixels.
  useEffect(() => {
    if (!run.photoKey) return
    let live = true
    getPhoto(run.photoKey)
      .then(async (blob) => {
        if (!blob) throw new Error('No saved photo')
        const img = await loadImage(blob)
        if (!live) return
        setShot({ url: URL.createObjectURL(blob), img })
        setRings(findRings(img))
      })
      .catch(() => live && setBad(true))
    return () => {
      live = false
    }
  }, [run.photoKey])
  useEffect(() => {
    if (shot) return () => URL.revokeObjectURL(shot.url)
  }, [shot])

  // The store refuses a photo for a run another tab has read meanwhile; the refresh then shows that result.
  const take = async (file: File) => {
    setBusy(true)
    setBad(false)
    try {
      const jpeg = await encodePhoto(file)
      await act(async () => void (await takePhoto(run.id, jpeg)))
    } catch {
      setBad(true)
    }
    setBusy(false)
  }

  /** A ring chosen by a tap or a key: removed while fixing rings, else taken as a control. */
  const pick = (i: number) => {
    if (stage === 'rings') return setRings(removeRing(rings, i))
    if (stage === 'pc') {
      setNotEnd(!pcAtEnd(rings, i))
      if (!pcAtEnd(rings, i)) return
      setPc(i)
      setStage('nc')
    } else if (i !== pc) {
      const roles = rolesFrom(rings.length, pc, i)
      // Refused if the run was read or retaken in another tab meanwhile; the refresh shows what's stored.
      void act(async () => void (await saveRead(run.id, run.photoKey!, rings, roles, readTubes(shot!.img, rings, roles), assay.treatAt)))
    }
  }
  const tap = (x: number, y: number, reach: number) => {
    const i = ringAt(rings, x, y, reach)
    if (i >= 0) pick(i)
    else if (stage === 'rings') setRings(addRing(rings, x, y))
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
  const picked = (i: number) => i === pc && stage === 'nc'
  const labels = rings.map((region, i) => ({
    region,
    label: picked(i) ? '+' : String(i + 1),
    tone: picked(i) ? ('picked' as const) : undefined,
    action: stage === 'rings' ? `Ring ${i + 1}, tap to remove` : picked(i) ? 'Positive control' : `Tube ${i + 1}`,
  }))
  return (
    <div className="screen">
      <Bar field={run.field} step="Photo" />
      <main className="body">
        <h1>{stage === 'rings' ? (n === assay.tubes ? `${n} tubes` : `${n} of ${assay.tubes} tubes`) : stage === 'pc' ? 'Tap the positive control' : 'Tap the negative control'}</h1>
        {stage === 'rings' && <p className="note">Tap a tube to ring it. Tap a ring to remove it.</p>}
        <Shot src={shot.url} rings={labels} onTap={tap} onRing={pick} hint={stage === 'rings' ? 'Adding a ring needs a tap on the photo.' : undefined} />
        {stage === 'pc' && notEnd && <p className="alert">Put the positive control at one end of the row.</p>}
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
          <button type="button" className="btn ghost" onClick={() => (setPc(-1), setNotEnd(false), setStage(stage === 'nc' ? 'pc' : 'rings'))}>
            Back
          </button>
        )}
      </footer>
    </div>
  )
}
