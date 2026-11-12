import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { sclerotinia } from './assays/sclerotinia'
import { currentStep, newRun, withStep } from './run'
import { getRun, listRuns, saveRun } from './store'
import { remainingMs } from './timer'

const run = (field: string, createdAt: number) => newRun(sclerotinia, { field, notes: '' }, createdAt, `id-${field}`)

describe('a new run', () => {
  it('follows the schema-1 shape: one step per guide step, ten empty taps, no outcome', () => {
    const r = newRun(sclerotinia, { field: '  North 40 ', notes: ' wet ' }, 5, 'a')
    expect(r).toMatchObject({ schema: 1, id: 'a', assay: 'sclerotinia', field: 'North 40', notes: 'wet', createdAt: 5 })
    expect(r.steps).toHaveLength(sclerotinia.steps.length)
    expect(r.steps.every((s) => !s.done)).toBe(true)
    expect(r.taps).toEqual(Array(10).fill(null))
    expect(r.outcome).toBeUndefined()
    expect('gps' in r).toBe(false)
    expect(r.appVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('keeps a location when given one', () => {
    const gps = { lat: 52.1, lon: -106.6, acc: 12 }
    expect(newRun(sclerotinia, { field: 'x', notes: '', gps }).gps).toEqual(gps)
  })
})

describe('the guide position', () => {
  it('is the first step not done, and -1 once all are done', () => {
    let r = run('g', 1)
    expect(currentStep(r)).toBe(0)
    r = withStep(withStep(r, 0, { done: true }), 1, { done: true })
    expect(currentStep(r)).toBe(2)
    r = withStep(r, 1, { done: false })
    expect(currentStep(r)).toBe(1)
    r = r.steps.reduce((acc, _, i) => withStep(acc, i, { done: true }), r)
    expect(currentStep(r)).toBe(-1)
  })

  it('ends on the cool-down, timed by coolMin', () => {
    expect(sclerotinia.steps.at(-1)?.timerMin).toBe(sclerotinia.coolMin)
  })
})

describe('the run store', () => {
  it('lists runs newest first', async () => {
    await saveRun(run('old', 1000))
    await saveRun(run('new', 3000))
    await saveRun(run('mid', 2000))
    expect((await listRuns()).map((r) => r.field)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps a timer start across a reload, so the time left is recomputed', async () => {
    const started = 1_700_000_000_000
    await saveRun(withStep(run('timer', 4000), 0, { timerStartedAt: started }))
    const back = await getRun('id-timer')
    expect(back?.steps[0].timerStartedAt).toBe(started)
    expect(remainingMs(back!.steps[0].timerStartedAt!, sclerotinia.steps[0].timerMin!, started + 5 * 60_000)).toBe(15 * 60_000)
  })

  it('overwrites a run saved again under the same id', async () => {
    await saveRun(withStep(run('same', 5000), 0, { done: true }))
    expect((await getRun('id-same'))?.steps[0].done).toBe(true)
    expect((await listRuns()).filter((r) => r.id === 'id-same')).toHaveLength(1)
  })
})
