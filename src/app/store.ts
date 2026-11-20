// Runs live in IndexedDB on the phone. Nothing leaves it.
// Photos get their own database: idb-keyval makes one object store per database.
//
// A run is written whole only when it is created. Every later change is a read-modify-write in one
// transaction that touches only its own field, so a second, stale tab can't erase progress.

import { createStore, del, get, set, update, values, type UseStore } from 'idb-keyval'
import type { Region } from '../lib/find'
import type { RunRead } from '../lib/readers'
import type { Role } from '../lib/synth'
import { READER_VERSION, SCHEMA, tally, upgrade, withStep, type Run, type StoredRun, type Tap } from './run'
import { needReload } from './update'

let db: UseStore | undefined
const runs = () => (db ??= createStore('pathoscan-field', 'runs'))
let photoDb: UseStore | undefined
const photos = () => (photoDb ??= createStore('pathoscan-photos', 'photos'))

export const getPhoto = (key: string) => get<Blob>(key, photos())

export const addRun = (run: Run) => set(run.id, run, runs())
/** True for a run saved by a newer app (another tab already updated). This page leaves it alone and offers Reload. */
function newer(run: StoredRun) {
  if (run.schema <= SCHEMA) return false
  needReload()
  return true
}

/** A run saved by a newer version of the app: the reason a read or a change of it fails. */
export class NewerRun extends Error {
  constructor(id: string) {
    super(`Run ${id} is from a newer version of the app`)
  }
}

/** Undefined if there's no such run. Fails with NewerRun if this app is too old to read it. */
export const getRun = async (id: string) => {
  const run = await get<StoredRun>(id, runs())
  if (run && newer(run)) throw new NewerRun(id)
  return run && upgrade(run)
}

/** Newest first, leaving out any this app is too old to read. */
export async function listRuns(): Promise<Run[]> {
  const all = await values<StoredRun>(runs())
  return all.filter((r) => !newer(r)).map(upgrade).sort((a, b) => b.createdAt - a.createdAt)
}

function change(id: string, edit: (run: Run) => Run): Promise<void> {
  return update<StoredRun>(
    id,
    (run) => {
      if (!run) throw new Error(`No run ${id}`)
      // Throwing here writes nothing.
      if (newer(run)) throw new NewerRun(id)
      return edit(upgrade(run))
    },
    runs(),
  )
}

export const setStepDone = (id: string, step: string, done: boolean) => change(id, (run) => withStep(run, step, { done }))

/** Starts the step's timer unless it is already running: the first start wins. */
export const startTimer = (id: string, step: string, at: number) =>
  change(id, (run) => (run.steps[step]?.timerStartedAt === undefined ? withStep(run, step, { timerStartedAt: at }) : run))

/**
 * Saves a photo under a new key and points the run at it, replacing (and deleting) the photo before. A run
 * that's already read keeps its photo: the new one is deleted and null comes back. If the run can't be
 * updated, the new photo is deleted too.
 */
export async function takePhoto(id: string, jpeg: Blob): Promise<string | null> {
  const key = `${id}/${crypto.randomUUID()}`
  await set(key, jpeg, photos())
  let old: string | undefined
  let taken = false
  try {
    await change(id, (run) => {
      if (run.read) return run
      ;[old, taken] = [run.photoKey, true]
      return { ...run, photoKey: key }
    })
  } catch (e) {
    await del(key, photos())
    throw e
  }
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

/**
 * Back to the photo step for a new photo: the photo at `photoKey` is deleted, with its rings, its read and the
 * grower's calls on it. The guide's progress, the field and the notes stay. Refused (false) if the run holds
 * another photo by now (another tab has retaken it).
 */
export async function retakePhoto(id: string, photoKey: string): Promise<boolean> {
  let done = false
  await change(id, (run) => {
    if (run.photoKey !== photoKey) return run
    done = true
    const { photoKey: _photo, regions: _regions, roles: _roles, read: _read, readerPositives: _rp, tappedPositives: _tp, rule: _rule, outcome: _outcome, ...rest } = run
    return { ...rest, taps: run.taps.map(() => null) }
  })
  if (done) await del(photoKey, photos())
  return done
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
