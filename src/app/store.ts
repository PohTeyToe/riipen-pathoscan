// Runs live in IndexedDB on the phone. Nothing leaves it.
// Photos will get their own database: idb-keyval makes one object store per database.
//
// A run is written whole only when it is created. Every later change is a read-modify-write in one
// transaction that touches only its own field, so a second, stale tab can't erase progress.

import { createStore, get, set, update, values, type UseStore } from 'idb-keyval'
import { withStep, type Run } from './run'

let db: UseStore | undefined
const runs = () => (db ??= createStore('pathoscan-field', 'runs'))

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

/** Ask the browser not to clear our data under storage pressure. Safe to call on every run. */
export async function askPersist(): Promise<void> {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
}
