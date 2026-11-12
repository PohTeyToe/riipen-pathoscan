import { version } from '../../package.json'
import type { Region } from '../lib/find'
import type { RunRead } from '../lib/readers'
import type { Role } from '../lib/synth'
import type { Assay } from './assays/assay'

/** Bump when the reader in src/lib or the MODEL and BAND in data/eval.json change. */
export const READER_VERSION = '1'

export type Outcome = 'treat' | 'dont-treat' | 'failed'

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
  /** The 10 confirmed rings, in reading order. */
  regions?: Region[]
  /** From the grower's two control taps. */
  roles?: Role[]
  /** Straight from readCalibrated. */
  read?: RunRead
  /** The grower's eye calls. Never overwrite `read`. */
  taps: (null | 'pos' | 'neg')[]
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
