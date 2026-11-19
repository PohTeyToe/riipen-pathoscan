import { describe, expect, it } from 'vitest'
import type { RunRead, TubeRead } from '../lib/readers'
import { sclerotinia } from './assays/sclerotinia'
import { cell, csvName, runCsv } from './csv'
import { ROLES } from './reader'
import { newRun, tally, type Run, type Tap } from './run'

const BOM = String.fromCharCode(0xfeff)
const at = new Date(2026, 10, 19, 7, 5).getTime() // local time, so the expected date and time hold in any zone

/** A read run: controls, then the given sample calls and the grower's taps (by tube index), tallied at treatAt 3. */
function readRun(samples: TubeRead['call'][], t: Record<number, Tap> = {}, status: RunRead['status'] = 'ok', extra: Partial<Run> = {}): Run {
  const flags = status === 'failed' ? ['The controls are too close to call.'] : []
  const read: RunRead = { status, flags, tubes: [{ call: 'pos', reason: '' }, { call: 'neg', reason: '' }, ...samples.map((call) => ({ call, reason: '' }))] }
  const taps = Array.from({ length: 10 }, (_, i) => t[i] ?? null)
  const run = { ...newRun(sclerotinia, { field: 'North 40', notes: '' }, at, 'run-1'), ...extra }
  return { ...run, read, roles: ROLES, taps, ...tally(read, ROLES, taps, 3) }
}

/** RFC 4180, strictly: rows end in CRLF, and a line break outside quotes, which a spreadsheet would split the row on, throws. */
function parse(csv: string): string[][] {
  const rows: string[][] = [[]]
  let value = ''
  let quoted = false
  const end = () => {
    rows.at(-1)!.push(value)
    value = ''
  }
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted && c === '"' && csv[i + 1] === '"') {
      value += '"'
      i++
    } else if (quoted && c === '"') quoted = false
    else if (quoted) value += c
    else if (c === '"' && value === '') quoted = true
    else if (c === ',') end()
    else if (c === '\r' && csv[i + 1] === '\n') {
      end()
      rows.push([])
      i++
    } else if (c === '\r' || c === '\n') throw new Error(`line break outside quotes at ${i}`)
    else value += c
  }
  expect(quoted).toBe(false)
  expect(rows.pop()).toEqual([]) // the file ends with a line break
  return rows
}

/** The file as one object per tube, keyed by header. */
function table(run: Run) {
  const csv = runCsv(run)
  expect(csv.startsWith(BOM)).toBe(true)
  const [head, ...rows] = parse(csv.slice(1))
  for (const r of rows) expect(r).toHaveLength(head.length)
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}
const column = (rows: Record<string, string>[], name: string) => rows.map((r) => r[name])

describe('a CSV cell', () => {
  it('quotes commas, quotes and line breaks, and leaves plain text alone', () => {
    expect(cell('North 40')).toBe('North 40')
    expect(cell('wet, after rain')).toBe('"wet, after rain"')
    expect(cell('the "low" corner')).toBe('"the ""low"" corner"')
    expect(cell('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(cell('a\r\nb')).toBe('"a\r\nb"')
    expect(cell(undefined)).toBe('')
  })

  it('turns text a spreadsheet would run as a formula into plain text', () => {
    expect(cell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`)
    expect(cell('+1 sprayed')).toBe("'+1 sprayed")
    expect(cell('-2 rows')).toBe("'-2 rows")
    expect(cell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(cell('\t=1')).toBe("'\t=1")
    for (const c of [0xff1d, 0xff0b, 0xff0d, 0xff20].map((n) => String.fromCharCode(n))) expect(cell(c + 'SUM(A1)')).toBe("'" + c + 'SUM(A1)') // full-width = + - @
    expect(cell('a=b')).toBe('a=b')
  })

  it('keeps numbers as numbers, negative ones too', () => {
    expect(cell(-106.67)).toBe('-106.67')
    expect(cell(0)).toBe('0')
  })
})

describe('the run CSV', () => {
  it('has a BOM, a header and one row per tube in label order, run fields on every row', () => {
    const rows = table(readRun(['pos', 'pos', 'neg', 'neg', 'pos', 'neg', 'neg', 'neg'], {}, 'ok', { gps: { lat: 52.123456, lon: -106.654321, acc: 8.6 } }))
    expect(rows).toHaveLength(10)
    expect(column(rows, 'Tube')).toEqual(['POS', 'NEG', '1', '2', '3', '4', '5', '6', '7', '8'])
    expect(rows[0]).toEqual({
      Field: 'North 40',
      Date: '2026-11-19',
      Time: '07:05',
      Result: 'Treat',
      Positives: '3',
      Samples: '8',
      'Treat at': '3',
      Tube: 'POS',
      'Reader call': 'Positive',
      'Grower call': '',
      'Final call': 'Positive',
      Notes: '',
      'Reader warnings': '',
      Latitude: '52.12346',
      Longitude: '-106.65432',
      'Accuracy (m)': '9',
      'App version': rows[0]['App version'],
      'Reader version': '1',
      'Run ID': 'run-1',
    })
    expect(rows[0]['App version']).toMatch(/^\d+\.\d+\.\d+$/)
    for (const name of ['Field', 'Date', 'Time', 'Result', 'Positives', 'Latitude', 'Run ID']) expect(new Set(column(rows, name)).size).toBe(1)
    expect(column(rows, 'Final call')).toEqual(['Positive', 'Negative', 'Positive', 'Positive', 'Negative', 'Negative', 'Positive', 'Negative', 'Negative', 'Negative'])
  })

  it("shows the grower's call on a held tube, counts it, and leaves an uncalled one held", () => {
    const samples: TubeRead['call'][] = ['pos', 'held', 'held', 'held', 'neg', 'neg', 'neg', 'neg']
    const rows = table(readRun(samples, { 3: 'pos', 4: 'neg' }))
    expect(column(rows, 'Reader call').slice(2, 6)).toEqual(['Positive', 'Held', 'Held', 'Held'])
    expect(column(rows, 'Grower call').slice(2, 6)).toEqual(['', 'Positive', 'Negative', ''])
    expect(column(rows, 'Final call').slice(2, 6)).toEqual(['Positive', 'Positive', 'Negative', 'Held'])
    expect(rows[0]).toMatchObject({ Positives: '2', Result: 'In progress' }) // tube 4 could still make it 3
    expect(table(readRun(samples, { 3: 'pos', 4: 'neg', 5: 'pos' }))[0]).toMatchObject({ Positives: '3', Result: 'Treat' })
  })

  it("marks a failed run, counts nothing and keeps the grower's taps as notes that don't count", () => {
    const rows = table(readRun(Array(8).fill('held'), { 2: 'pos', 3: 'neg' }, 'failed'))
    expect(rows[0]).toMatchObject({ Result: 'Failed', Positives: '', 'Reader warnings': 'The controls are too close to call.' })
    expect(column(rows, 'Grower call').slice(2, 4)).toEqual(['Positive', 'Negative'])
    expect(column(rows, 'Final call').slice(2)).toEqual(Array(8).fill('Held'))
  })

  it('carries notes with commas, quotes and line breaks whole, and defuses formulas in free text', () => {
    const notes = 'Wet, after rain.\nSample 3 from the "low" corner'
    const rows = table(readRun(Array(8).fill('neg'), {}, 'ok', { field: '=1+1', notes }))
    expect(column(rows, 'Notes')).toEqual(Array(10).fill(notes))
    expect(column(rows, 'Field')).toEqual(Array(10).fill("'=1+1"))
    expect(rows[0]).toMatchObject({ Result: "Don't treat", Positives: '0', Latitude: '', Longitude: '', 'Accuracy (m)': '' })
  })
})

describe('the file name', () => {
  const name = (field: string) => csvName(newRun(sclerotinia, { field, notes: '' }, at))
  it('is pathoscan-<field>-<date>.csv with only lowercase letters, digits and dashes', () => {
    expect(name('North 40')).toBe('pathoscan-north-40-2026-11-19.csv')
    expect(name('Côte / Field #3: "east"')).toBe('pathoscan-cote-field-3-east-2026-11-19.csv')
    expect(name('../../etc')).toBe('pathoscan-etc-2026-11-19.csv')
    expect(name('田んぼ')).toBe('pathoscan-run-2026-11-19.csv')
    expect(name('a'.repeat(39) + ' b c')).toBe(`pathoscan-${'a'.repeat(39)}-2026-11-19.csv`)
  })
})
