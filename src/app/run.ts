import { version } from '../../package.json'
import type { Region } from '../lib/find'
import type { RunRead } from '../lib/readers'
import type { Role } from '../lib/synth'
import type { Assay } from './assays/assay'

/** Bump when the reader in src/lib or the MODEL and BAND in data/eval.json change. */
export const READER_VERSION = '1'

export type Outcome = 'treat' | 'dont-treat' | 'failed'
export type Tap = null | 'pos' | 'neg'

export interface Run {
  schema: 1
  id: string
  assay: string
  field: string
  notes: string
  gps?: { lat: number; lon: number; acc: number }
  createdAt: number
  steps: { done: boolean; timerStartedAt?: number }[]
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
  /** The rule in force when the outcome was set. */
  rule?: { treatAt: number }
  outcome?: Outcome
  appVersion: string
  readerVersion: string
}

export function newRun(assay: Assay, input: Pick<Run, 'field' | 'notes' | 'gps'>, now = Date.now(), id: string = crypto.randomUUID()): Run {
  return {
    schema: 1,
    id,
    assay: assay.id,
    field: input.field.trim(),
    notes: input.notes.trim(),
    ...(input.gps && { gps: input.gps }),
    createdAt: now,
    steps: assay.steps.map(() => ({ done: false })),
    taps: Array(assay.tubes).fill(null),
    appVersion: version,
    readerVersion: READER_VERSION,
  }
}

/** The step to show: the first one not done, or -1 when the guide is finished. */
export const currentStep = (run: Run) => run.steps.findIndex((s) => !s.done)

/** A copy of the run with step `i` changed. */
export function withStep(run: Run, i: number, patch: Partial<Run['steps'][number]>): Run {
  return { ...run, steps: run.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }
}

export const OUTCOME_LABEL: Record<Outcome | 'open', string> = {
  treat: 'Treat',
  'dont-treat': "Don't treat",
  failed: 'Failed',
  open: 'In progress',
}

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

/** True when the reader's calls alone left the run either side of treatAt, so the grower's taps decided it. */
export function tapsDecided(run: Run): boolean {
  if (!run.read || !run.roles || !run.rule || (run.outcome !== 'treat' && run.outcome !== 'dont-treat')) return false
  const reader = run.readerPositives ?? 0
  return reader < run.rule.treatAt && reader + heldSamples(run.read, run.roles).length >= run.rule.treatAt
}
