// Runs live in IndexedDB on the phone. Nothing leaves it.
// Photos get their own database: idb-keyval makes one object store per database.
//
// A run is written whole only when it is created. Every later change is a read-modify-write in one
// transaction that touches only its own field, so a second, stale tab can't erase progress.

import { createStore, del, get, set, update, values, type UseStore } from 'idb-keyval'
import type { Region } from '../lib/find'
import type { RunRead } from '../lib/readers'
import type { Role } from '../lib/synth'
import { READER_VERSION, tally, withStep, type Run, type Tap } from './run'

let db: UseStore | undefined
const runs = () => (db ??= createStore('pathoscan-field', 'runs'))
let photoDb: UseStore | undefined
const photos = () => (photoDb ??= createStore('pathoscan-photos', 'photos'))

export const getPhoto = (key: string) => get<Blob>(key, photos())

export const addRun = (run: Run) => set(run.id, run, runs())
export const getRun = (id: string) => get<Run>(id, runs())

/** Newest first. */
export async function listRuns(): Promise<Run[]> {
  return (await values<Run>(runs())).sort((a, b) => b.createdAt - a.createdAt)
}

function change(id: string, edit: (run: Run) => Run): Promise<void> {
  return update<Run>(
    id,
    (run) => {
      if (!run) throw new Error(`No run ${id}`)
      return edit(run)
    },
    runs(),
  )
}

export const setStepDone = (id: string, i: number, done: boolean) => change(id, (run) => withStep(run, i, { done }))

/** Starts step i's timer unless it is already running: the first start wins. */
export const startTimer = (id: string, i: number, at: number) =>
  change(id, (run) => (run.steps[i].timerStartedAt === undefined ? withStep(run, i, { timerStartedAt: at }) : run))

/**
 * Saves a photo under a new key and points the run at it, replacing (and deleting) the photo before. A run
 * that's already read keeps its photo: the new one is deleted and null comes back.
 */
export async function takePhoto(id: string, jpeg: Blob): Promise<string | null> {
  const key = `${id}/${crypto.randomUUID()}`
  await set(key, jpeg, photos())
  let old: string | undefined
  let taken = false
  await change(id, (run) => {
    if (run.read) return run
    ;[old, taken] = [run.photoKey, true]
    return { ...run, photoKey: key }
  })
  if (taken && old) await del(old, photos())
  if (!taken) await del(key, photos())
  return taken ? key : null
}

/**
 * Stores the confirmed rings, the control taps and the read of the photo at `photoKey`, with what they come to.
 * Refused (false) if the run is already read or another tab has put a different photo on it since.
 */
export async function saveRead(id: string, photoKey: string, regions: Region[], roles: Role[], read: RunRead, treatAt: number): Promise<boolean> {
  let saved = false
  await change(id, (run) => {
    if (run.read || run.photoKey !== photoKey) return run
    saved = true
    return { ...run, regions, roles, read, readerVersion: READER_VERSION, ...tally(read, roles, run.taps, treatAt) }
  })
  return saved
}

/** The grower's eye call on tube i, kept apart from the reader's. Recounts the outcome under the current rule. */
export const setTap = (id: string, i: number, tap: Tap, treatAt: number) =>
  change(id, (run) => {
    if (!run.read || !run.roles) return run
    const taps = run.taps.map((t, j) => (j === i ? tap : t))
    return { ...run, taps, ...tally(run.read, run.roles, taps, treatAt) }
  })

/** Ask the browser not to clear our data under storage pressure. Safe to call on every run. */
export async function askPersist(): Promise<void> {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
}
