// Runs live in IndexedDB on the phone. Nothing leaves it.
// Photos get their own database: idb-keyval makes one object store per database.
//
// A run is written whole only when it is created. Every later change is a read-modify-write in one
// transaction that touches only its own field, so a second, stale tab can't erase progress. Every change
// names the take of the run's photo that its screen was drawn from, and is refused once the run is on another
// take, so a stale tab can't change a newer photo's result or reopen the guide of a run retaken since.

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

/**
 * Undefined if there's no such run. Fails with NewerRun if this app is too old to read it. A run an older app
 * saved is stored upgraded before any screen shows it, so a tab of that app still open on it leaves it alone
 * from then on and offers Reload: that app can't bind its writes to the photo on show.
 */
export const getRun = async (id: string): Promise<Run | undefined> => {
  const run = await get<StoredRun>(id, runs())
  if (run && newer(run)) throw new NewerRun(id)
  return run && (run.schema === SCHEMA ? run : rewrite(id, (r) => r))
}

/** Newest first, leaving out any this app is too old to read. */
export async function listRuns(): Promise<Run[]> {
  const all = await values<StoredRun>(runs())
  return all.filter((r) => !newer(r)).map(upgrade).sort((a, b) => b.createdAt - a.createdAt)
}

/** Stores run `id` upgraded and edited, in one transaction, and gives what it stored. Throwing in it writes nothing. */
async function rewrite(id: string, edit: (run: Run) => Run): Promise<Run> {
  let stored!: Run
  await update<StoredRun>(
    id,
    (run) => {
      if (!run) throw new Error(`No run ${id}`)
      if (newer(run)) throw new NewerRun(id)
      return (stored = edit(upgrade(run)))
    },
    runs(),
  )
  return stored
}

/** The run as a screen drew it: which run, and which take of its photo. */
export type Seen = Pick<Run, 'id' | 'take'>

/** A change made on a screen drawn from `seen`. Refused (false, nothing changed) if the run is on another take by now, or if `edit` refuses (null). */
async function change(seen: Seen, edit: (run: Run) => Run | null): Promise<boolean> {
  let done = false
  await rewrite(seen.id, (run) => {
    const next = run.take === seen.take ? edit(run) : null
    done = next !== null
    return next ?? run
  })
  return done
}

/** A read run's guide is over: a stale tab still on a step or on the photo can't reopen or restart one. */
export const setStepDone = (seen: Seen, step: string, done: boolean) => change(seen, (run) => (run.read ? null : withStep(run, step, { done })))

/** Starts the step's timer unless it is already running: the first start wins. */
export const startTimer = (seen: Seen, step: string, at: number) =>
  change(seen, (run) => (run.read || run.steps[step]?.timerStartedAt !== undefined ? null : withStep(run, step, { timerStartedAt: at })))

/**
 * Saves a photo under a new key and points the run at it, a new take, replacing (and deleting) the photo before.
 * A run that's already read keeps its photo: the new one is deleted and null comes back. If the run can't be
 * updated, the new photo is deleted too.
 */
export async function takePhoto(seen: Seen, jpeg: Blob): Promise<string | null> {
  const key = `${seen.id}/${crypto.randomUUID()}`
  await set(key, jpeg, photos())
  let old: string | undefined
  let taken: boolean
  try {
    taken = await change(seen, (run) => {
      if (run.read) return null
      old = run.photoKey
      return { ...run, take: run.take + 1, photoKey: key }
    })
  } catch (e) {
    await del(key, photos())
    throw e
  }
  const drop = taken ? old : key
  if (drop) await del(drop, photos())
  return taken ? key : null
}

/** Stores the confirmed rings, the control taps and the read of the run's photo, with what they come to. Refused (false) if the run is already read. */
export const saveRead = (seen: Seen, regions: Region[], roles: Role[], read: RunRead, treatAt: number) =>
  change(seen, (run) => (run.read || !run.photoKey ? null : { ...run, regions, roles, read, readerVersion: READER_VERSION, ...tally(read, roles, run.taps, treatAt) }))

/**
 * Back to the photo step for a new photo, a new take: the photo is deleted, with its rings, its read and the
 * grower's calls on it. The guide's progress, the field and the notes stay.
 */
export async function retakePhoto(seen: Seen): Promise<boolean> {
  let old: string | undefined
  const done = await change(seen, (run) => {
    if (!run.photoKey) return null
    old = run.photoKey
    const { photoKey: _photo, regions: _regions, roles: _roles, read: _read, readerPositives: _rp, tappedPositives: _tp, rule: _rule, outcome: _outcome, ...rest } = run
    return { ...rest, take: run.take + 1, taps: run.taps.map(() => null) }
  })
  if (done && old) await del(old, photos())
  return done
}

/** The grower's eye call on tube i of the read, kept apart from the reader's. Recounts the outcome under the current rule. Refused (false) if the reader didn't hold that tube. */
export const setTap = (seen: Seen, i: number, tap: Tap, treatAt: number) =>
  change(seen, (run) => {
    if (!run.read || !run.roles || run.read.tubes[i]?.call !== 'held') return null
    const taps = run.taps.map((t, j) => (j === i ? tap : t))
    return { ...run, taps, ...tally(run.read, run.roles, taps, treatAt) }
  })

/** Ask the browser not to clear our data under storage pressure. Safe to call on every run. */
export async function askPersist(): Promise<void> {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
}
