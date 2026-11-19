// A run as a CSV file: one row per tube, the run's fields repeated on every row so a spreadsheet sorts and
// filters it as one flat table. Built on the phone from the stored run, so it works offline.

import type { Call } from '../lib/readers'
import { LABELS } from './reader'
import { finalCalls, OUTCOME_LABEL, type Run, type Tap } from './run'

type Cell = string | number | undefined

const CALL: Record<Call, string> = { pos: 'Positive', neg: 'Negative', held: 'Held' }
const TAP: Record<NonNullable<Tap>, string> = { pos: 'Positive', neg: 'Negative' }

const pad = (n: number) => String(n).padStart(2, '0')
/** The phone's local date and time, as yyyy-mm-dd and hh:mm, which both spreadsheets read as a date and a time. */
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * One cell. Text a spreadsheet would run as a formula (it starts with = + - @, their full-width forms, a tab
 * or a carriage return) gets a leading apostrophe. A cell with a comma, a quote or a line break is quoted.
 * Numbers stay numbers, so a negative longitude is still a number.
 */
export function cell(v: Cell): string {
  if (v === undefined) return ''
  if (typeof v === 'number') return String(v)
  const s = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

const HEADER = ['Field', 'Date', 'Time', 'Result', 'Positives', 'Samples', 'Treat at', 'Tube', 'Reader call', 'Grower call', 'Final call', 'Notes', 'Reader warnings', 'Latitude', 'Longitude', 'Accuracy (m)', 'App version', 'Reader version', 'Run ID']

/** The CSV for a read run: a UTF-8 BOM (so Excel reads accents right), a header, then one row per tube in label order. */
export function runCsv(run: Run): string {
  const read = run.read!
  const final = finalCalls(run)
  const positives = run.outcome === 'failed' ? undefined : (run.readerPositives ?? 0) + (run.tappedPositives ?? 0)
  const samples = run.roles!.filter((r) => r === 'sample').length
  const at = new Date(run.createdAt)
  const rows = run.roles!.map((role, i): Cell[] => {
    const tap = run.taps[i]
    return [
      run.field,
      day(at),
      time(at),
      OUTCOME_LABEL[run.outcome ?? 'open'],
      positives,
      samples,
      run.rule?.treatAt,
      role === 'pc' ? 'POS' : role === 'nc' ? 'NEG' : LABELS[i],
      CALL[read.tubes[i].call],
      tap ? TAP[tap] : undefined,
      CALL[final[i]],
      run.notes,
      read.flags.join('; '),
      run.gps && Number(run.gps.lat.toFixed(5)),
      run.gps && Number(run.gps.lon.toFixed(5)),
      run.gps && Math.round(run.gps.acc),
      run.appVersion,
      run.readerVersion,
      run.id,
    ]
  })
  return '\uFEFF' + [HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** pathoscan-<field>-<yyyy-mm-dd>.csv, the field cut down to lowercase letters, digits and dashes. */
export function csvName(run: Run): string {
  const field = run.field
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents off: é becomes e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')
  return `pathoscan-${field || 'run'}-${day(new Date(run.createdAt))}.csv`
}

/** Shares the file where the phone can share files, else downloads it. Call it from the tap: sharing needs one. */
export async function exportRun(run: Run): Promise<void> {
  const file = new File([runCsv(run)], csvName(run), { type: 'text/csv' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      // The grower closed the share sheet. A phone with no app to share to says the same, but that's rare,
      // and a download after every cancel would be worse.
      if ((e as DOMException).name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}
