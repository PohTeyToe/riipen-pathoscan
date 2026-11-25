import { version } from '../../package.json'
import type { Region } from '../lib/find'
import type { Call, RunRead } from '../lib/readers'
import type { Role } from '../lib/synth'
import type { Assay } from './assays/assay'

/** Bump when the reader in src/lib or the MODEL and BAND in data/eval.json change. */
export const READER_VERSION = '2'

export type Outcome = 'treat' | 'dont-treat' | 'failed'
export type Tap = null | 'pos' | 'neg'

/** A guide step's progress. A step with no entry hasn't been started. */
export interface StepProgress {
  done: boolean
  timerStartedAt?: number
}

/**
 * The newest run shape this app reads and writes. A run saved with a higher one came from a newer app, which
 * that app leaves alone. Schema 3 added `take`: an app of schema 2 can't bind its writes to the photo on show,
 * so the bump also fences its tabs off the runs this app has opened. Schema 4 has schema 3's shape: an app of
 * schema 3 recounts a run under its own treatAt on every tap, so it must not write to a run this app has opened.
 */
export const SCHEMA = 4

export interface Run {
  schema: typeof SCHEMA
  id: string
  assay: string
  field: string
  notes: string
  gps?: { lat: number; lon: number; acc: number }
  createdAt: number
  /** Keyed by step id, so a guide that gains, loses or reorders steps keeps each step's progress on that step. */
  steps: Partial<Record<string, StepProgress>>
  /** Which photo the run is on: 0 before the first, one more each time a photo is taken, replaced or cleared for a retake. */
  take: number
  /** IndexedDB key of the saved JPEG. */
  photoKey?: string
  /** The 10 labelled rings, in the order the grower tapped them: +, −, then samples 1 to 8. */
  regions?: Region[]
  /** From the grower's tap order: 'pc', 'nc', then eight 'sample'. */
  roles?: Role[]
  /** Straight from readCalibrated. */
  read?: RunRead
  /** The grower's eye calls. Never overwrite `read`. */
  taps: Tap[]
  readerPositives?: number
  tappedPositives?: number
  /** The rule the run was read under. A tap recounts the run under this rule, never the assay's rule of the day. */
  rule?: { treatAt: number }
  outcome?: Outcome
  appVersion: string
  readerVersion: string
}

export function newRun(assay: Assay, input: Pick<Run, 'field' | 'notes' | 'gps'>, now = Date.now(), id: string = crypto.randomUUID()): Run {
  return {
    schema: SCHEMA,
    id,
    assay: assay.id,
    field: input.field.trim(),
    notes: input.notes.trim(),
    ...(input.gps && { gps: input.gps }),
    createdAt: now,
    steps: {},
    take: 0,
    taps: Array(assay.tubes).fill(null),
    appVersion: version,
    readerVersion: READER_VERSION,
  }
}

/** The index of the step to show: the first one not done, or -1 when the guide is finished. */
export const currentStep = (run: Run, assay: Assay) => assay.steps.findIndex((s) => !run.steps[s.id]?.done)

/** A copy of the run with step `stepId` changed. */
export function withStep(run: Run, stepId: string, patch: Partial<StepProgress>): Run {
  return { ...run, steps: { ...run.steps, [stepId]: { done: false, ...run.steps[stepId], ...patch } } }
}

/** A run as IndexedDB may hold it: the current shape, or one saved by an older app. */
export type StoredRun =
  | Run
  | (Omit<Run, 'schema'> & { schema: 3 })
  | (Omit<Run, 'schema' | 'take'> & { schema: 2 })
  | (Omit<Run, 'schema' | 'take' | 'steps'> & { schema: 1; steps: StepProgress[] })

/** Schema 1 kept step progress in an array, by position in the guide of the day: these steps, in this order. */
const SCHEMA_1_STEPS: Record<string, string[]> = { sclerotinia: ['preheat', 'label', 'mix', 'crush', 'dip', 'oil', 'shade', 'cool'] }

/**
 * A stored run in the current shape. An older run is on its first take. A schema-1 run's progress moves onto
 * its steps' ids. Picking the samples came in after schema 1: a run already under way had its samples, so that
 * step counts as done.
 */
export function upgrade(run: StoredRun): Run {
  if (run.schema === SCHEMA) return run
  if (run.schema === 3) return { ...run, schema: SCHEMA }
  if (run.schema === 2) return { ...run, schema: SCHEMA, take: 0 }
  const ids = SCHEMA_1_STEPS[run.assay] ?? []
  const steps: Run['steps'] = Object.fromEntries(run.steps.flatMap((s, i) => (ids[i] ? [[ids[i], s]] : [])))
  if (run.steps.some((s) => s.done || s.timerStartedAt !== undefined)) steps.pick = { done: true }
  return { ...run, schema: SCHEMA, take: 0, steps }
}

export const OUTCOME_LABEL: Record<Outcome | 'open', string> = {
  treat: 'Treat',
  'dont-treat': "Don't treat",
  failed: 'Failed',
  open: 'In progress',
}

/** Why the reader held tube i, unless a run flag already says so (a failed run holds every sample for its flag). */
export function heldReason(read: RunRead, i: number): string | undefined {
  const t = read.tubes[i]
  return t.call === 'held' && t.reason && !read.flags.includes(t.reason) ? t.reason : undefined
}

/** True when the reader asks for a new photo: a run flag or a held tube's reason says to retake it. */
export const asksRetake = (read: RunRead) => [...read.flags, ...read.tubes.flatMap((_, i) => heldReason(read, i) ?? [])].some((s) => /\bretake\b/i.test(s))

/** Samples the reader held: the only tubes a grower's tap fills in. */
export const heldSamples = (read: RunRead, roles: Role[]) => roles.flatMap((r, i) => (r === 'sample' && read.tubes[i].call === 'held' ? [i] : []))

export type Tally = Required<Pick<Run, 'rule'>> & Pick<Run, 'readerPositives' | 'tappedPositives' | 'outcome'>

/**
 * What a read and the grower's taps come to under the rule. The reader decides every tube it called, a tap
 * decides only a held one. While untapped held tubes could still move the run across treatAt, there is no
 * outcome yet. A failed run counts nothing: its taps are notes.
 */
export function tally(read: RunRead, roles: Role[], taps: Tap[], treatAt: number): Tally {
  const rule = { treatAt }
  if (read.status === 'failed') return { rule, readerPositives: undefined, tappedPositives: undefined, outcome: 'failed' }
  const held = heldSamples(read, roles)
  const readerPositives = roles.filter((r, i) => r === 'sample' && read.tubes[i].call === 'pos').length
  const tappedPositives = held.filter((i) => taps[i] === 'pos').length
  const open = held.filter((i) => !taps[i]).length
  const known = readerPositives + tappedPositives
  const outcome = known >= treatAt ? 'treat' : known + open < treatAt ? 'dont-treat' : undefined
  return { rule, readerPositives, tappedPositives, outcome }
}

/**
 * Each tube's call as it counts: the reader's, or the grower's tap on a tube the reader held. A failed run's
 * taps are notes, so its held tubes stay held.
 */
export const finalCalls = (run: Run): Call[] =>
  run.read!.tubes.map((t, i) => (t.call === 'held' && run.taps[i] && run.outcome !== 'failed' ? run.taps[i] : t.call))

/** True when the reader's calls alone left the run either side of treatAt, so the grower's taps decided it. */
export function tapsDecided(run: Run): boolean {
  if (!run.read || !run.roles || !run.rule || (run.outcome !== 'treat' && run.outcome !== 'dont-treat')) return false
  const reader = run.readerPositives ?? 0
  return reader < run.rule.treatAt && reader + heldSamples(run.read, run.roles).length >= run.rule.treatAt
}
