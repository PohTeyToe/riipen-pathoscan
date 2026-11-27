import { useEffect, useState, type ReactNode } from 'react'
import type { Region } from '../lib/find'
import { loadImage } from '../lib/photo'
import type { Img } from '../lib/synth'
import type { Assay } from './assays/assay'
import { encodePhoto } from './camera'
import { findRings, LABELS, MIN_TUBES, readTubes, removeRing, ringAt, ROLES, tapInOrder, tapRings } from './reader'
import { treatAtFor, type Run } from './run'
import { Shot } from './Shot'
import { getPhoto, saveRead, takePhoto } from './store'
import { Bar, useArmed } from './ui'

/** The line under the ring count: while the count can't be read, why and what to do; else how rings are fixed. */
export const ringsNote = (n: number) =>
  n > LABELS.length
    ? 'Too many rings. Tap the extra ones to remove them.'
    : n < MIN_TUBES
      ? 'Too few rings. Tap each tube that has no ring.'
      : 'Tap a tube to ring it. Tap a ring to remove it.'

interface Props {
  run: Run
  assay: Assay
  act: (write: () => Promise<unknown>) => Promise<void>
  back: ReactNode
  error: ReactNode
}

/**
 * Take the photo, fix the rings, then label them by tapping the tubes in the order of the labels on the paper.
 * Roles come only from that order, never from where a tube sits. Continue reads the run and saves it. Guide
 * gives each stored photo its own instance of this screen, so the rings on show are always the stored photo's.
 * A run may have fewer samples than a full kit: then the button says how many it will read, and a line under
 * it says a full kit has more, so a tube the finder missed isn't read as a short run unnoticed.
 */
export function Photo({ run, assay, act, back, error }: Props) {
  const [shot, setShot] = useState<{ url: string; img: Img }>()
  const [rings, setRings] = useState<Region[]>([])
  const [stage, setStage] = useState<'rings' | 'label'>('rings')
  /** Ring indices in label order: order[0] is +, order[1] is −, then the samples from 1. */
  const [order, setOrder] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState(false)
  // Opened by Done on the last step: a double tap there mustn't also open the camera.
  const armed = useArmed()

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

  // The store refuses a photo if another tab has taken one or read the run meanwhile; the refresh then shows that.
  const take = async (file: File) => {
    setBusy(true)
    setBad(false)
    try {
      const jpeg = await encodePhoto(file)
      await act(() => takePhoto(run, jpeg))
    } catch {
      setBad(true)
    }
    setBusy(false)
  }

  /** A ring chosen by a tap or a key: removed while fixing rings, else labelled or unlabelled. */
  const pick = (i: number) => (stage === 'rings' ? setRings(removeRing(rings, i)) : setOrder(tapInOrder(order, i)))
  // Stored in label order, so each tube's role and name is its position.
  const save = () => {
    const tubes = order.map((i) => rings[i])
    const roles = ROLES.slice(0, tubes.length)
    // Refused if the run was read or its photo changed in another tab meanwhile; the refresh shows what's stored.
    void act(() => saveRead(run, tubes, roles, readTubes(shot!.img, tubes, roles), treatAtFor(assay, tubes.length - 2)))
  }
  const tap = (x: number, y: number, reach: number) => {
    if (stage === 'rings') return setRings(tapRings(rings, x, y, reach))
    const i = ringAt(rings, x, y, reach)
    if (i >= 0) pick(i)
  }

  const camera = (label: string, ghost?: boolean) => (
    <label className={ghost ? 'btn ghost camera' : 'btn camera'} data-arming={armed ? undefined : ''}>
      {busy ? 'Reading…' : label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy || !armed}
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
          <p className="lead">All the tubes, + and − too, on white paper, in shade.</p>
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
  const kit = LABELS.length
  const readable = n >= MIN_TUBES && n <= kit
  // A full kit reads as it always has. A run of fewer tubes says how many samples it reads, on the button itself.
  const samples = n - 2
  const short = readable && n < kit
  const go = short ? `Read ${samples} sample${samples === 1 ? '' : 's'}` : 'Continue'
  const next = LABELS[order.length]
  const labels = rings.map((region, i) => {
    const label = stage === 'label' ? (LABELS[order.indexOf(i)] ?? '') : ''
    return {
      region,
      label,
      tone: label ? ('picked' as const) : undefined,
      action:
        stage === 'rings'
          ? `Ring ${i + 1}, tap to remove`
          : label
            ? `Ring ${i + 1}, labelled ${label}: tap to undo`
            : next
              ? `Ring ${i + 1}: tap to label ${next}`
              : `Ring ${i + 1}`,
    }
  })
  return (
    <div className="screen photo">
      <Bar field={run.field} step="Photo" />
      <main className="body">
        <div className="side">
          <h1>{stage === 'label' ? `${order.length} of ${n} labelled` : n === kit ? `${n} tubes` : `${n} of ${kit} tubes`}</h1>
          <p className="note">
            {stage === 'rings' ? ringsNote(n) : `Tap the tubes in order: +, −, then ${samples === 1 ? '1' : `1 to ${samples}`}.`}
          </p>
          {status}
          {error}
        </div>
        <Shot src={shot.url} rings={labels} onTap={tap} onRing={pick} hint={stage === 'rings' ? 'Adding a ring needs a tap on the photo.' : undefined} />
      </main>
      <footer className="actions">
        {stage === 'rings' ? (
          camera('Retake', true)
        ) : (
          <button type="button" className="btn ghost" onClick={() => (setOrder([]), setStage('rings'))}>
            Back
          </button>
        )}
        <button type="button" className="btn" disabled={stage === 'rings' ? !readable : order.length !== n} onClick={stage === 'rings' ? () => setStage('label') : save}>
          {go}
        </button>
        {short && (
          <p className="note under">
            A full kit has {kit - 2} samples. {stage === 'rings' ? 'Tap any tube that has no ring.' : 'Tap Back to ring a tube that has none.'}
          </p>
        )}
      </footer>
    </div>
  )
}
