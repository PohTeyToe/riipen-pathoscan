// Runs live in IndexedDB on the phone. Nothing leaves it.
// Photos will get their own database: idb-keyval makes one object store per database.

import { createStore, get, set, values, type UseStore } from 'idb-keyval'
import type { Run } from './run'

let db: UseStore | undefined
const runs = () => (db ??= createStore('pathoscan-field', 'runs'))

export const saveRun = (run: Run) => set(run.id, run, runs())
export const getRun = (id: string) => get<Run>(id, runs())

/** Newest first. */
export async function listRuns(): Promise<Run[]> {
  return (await values<Run>(runs())).sort((a, b) => b.createdAt - a.createdAt)
}

/** Ask the browser not to clear our data under storage pressure. Safe to call on every run. */
export async function askPersist(): Promise<void> {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
}
