import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { sclerotinia } from './assays/sclerotinia'
import { currentStep, newRun, withStep } from './run'
import type { RunRead } from '../lib/readers'
import { rolesFrom } from './reader'
import { addRun, getPhoto, getRun, listRuns, savePhoto, saveRead, setPhoto, setStepDone, setTap, startTimer } from './store'
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
    await addRun(run('old', 1000))
    await addRun(run('new', 3000))
    await addRun(run('mid', 2000))
    expect((await listRuns()).map((r) => r.field)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps a timer start across a reload, so the time left is recomputed', async () => {
    const started = 1_700_000_000_000
    await addRun(withStep(run('timer', 4000), 0, { timerStartedAt: started }))
    const back = await getRun('id-timer')
    expect(back?.steps[0].timerStartedAt).toBe(started)
    expect(remainingMs(back!.steps[0].timerStartedAt!, sclerotinia.steps[0].timerMin!, started + 5 * 60_000)).toBe(15 * 60_000)
  })

  it('marks a step done and undoes it', async () => {
    await addRun(run('step', 5000))
    await setStepDone('id-step', 0, true)
    expect((await getRun('id-step'))?.steps[0].done).toBe(true)
    await setStepDone('id-step', 0, false)
    expect((await getRun('id-step'))?.steps[0].done).toBe(false)
  })

  it('keeps the first timer start', async () => {
    await addRun(run('first', 5000))
    await startTimer('id-first', 0, 111)
    await startTimer('id-first', 0, 222)
    expect((await getRun('id-first'))?.steps[0].timerStartedAt).toBe(111)
  })

  it('refuses a change to a run that is not there, and writes nothing', async () => {
    await expect(setStepDone('id-nope', 0, true)).rejects.toThrow()
    expect(await getRun('id-nope')).toBeUndefined()
  })

  it("keeps one tab's progress when a stale second tab writes", async () => {
    // Two tabs: two separate connections to the same database.
    const tabA = { addRun, getRun, setStepDone, startTimer }
    vi.resetModules()
    const tabB = await import('./store')
    expect(tabB.getRun).not.toBe(tabA.getRun)

    await tabA.addRun(run('tabs', 6000))
    const seenByB = await tabB.getRun('id-tabs')
    await tabA.setStepDone('id-tabs', 0, true)
    await tabA.setStepDone('id-tabs', 1, true)
    expect(seenByB?.steps[0].done).toBe(false) // B's screen is now stale

    await tabB.startTimer('id-tabs', 2, 333)
    await tabB.setStepDone('id-tabs', 0, true)
    const stored = await tabA.getRun('id-tabs')
    expect(stored?.steps.slice(0, 3).map((s) => s.done)).toEqual([true, true, false])
    expect(stored?.steps[2].timerStartedAt).toBe(333)
  })
})

describe('the read and the taps', () => {
  const roles = rolesFrom(10, 0, 1)
  const read = (samples: ('pos' | 'neg' | 'held')[], status: RunRead['status'] = 'ok'): RunRead => ({
    status,
    flags: [],
    tubes: [{ call: 'pos', reason: '' }, { call: 'neg', reason: '' }, ...samples.map((call) => ({ call, reason: '' }))],
  })
  const regions = roles.map((_, i) => ({ x0: i, y0: 0, x1: i + 1, y1: 1, cx: i, cy: 0 }))
  const twoHeld = read(['pos', 'pos', 'held', 'held', 'neg', 'neg', 'neg', 'neg'])

  it('keeps the photo apart from the run and points the run at it', async () => {
    await addRun(run('photo', 7000))
    await savePhoto('id-photo', new Blob(['jpeg'], { type: 'image/jpeg' }))
    await setPhoto('id-photo', 'id-photo')
    expect((await getRun('id-photo'))?.photoKey).toBe('id-photo')
    expect(await getPhoto('id-photo')).toBeDefined()
  })

  it('stores the read with its count and outcome, and the first read wins', async () => {
    await addRun(run('read', 7100))
    await saveRead('id-read', regions, roles, twoHeld, 3)
    await saveRead('id-read', regions, roles, read(Array(8).fill('pos')), 3)
    await setPhoto('id-read', 'other')
    const r = await getRun('id-read')
    expect(r).toMatchObject({ read: twoHeld, roles, regions, readerPositives: 2, tappedPositives: 0, rule: { treatAt: 3 }, readerVersion: '1' })
    expect(r?.outcome).toBeUndefined()
    expect(r?.photoKey).toBeUndefined()
  })

  it("keeps taps apart from the read and recounts, without losing a stale tab's tap", async () => {
    await addRun(run('taps', 7200))
    await saveRead('id-taps', regions, roles, twoHeld, 3)
    vi.resetModules()
    const tabB = await import('./store')
    await setTap('id-taps', 4, 'neg', 3)
    await tabB.setTap('id-taps', 5, 'pos', 3) // B never saw A's tap
    const r = await getRun('id-taps')
    expect(r?.taps.slice(4, 6)).toEqual(['neg', 'pos'])
    expect(r?.read).toEqual(twoHeld)
    expect(r).toMatchObject({ readerPositives: 2, tappedPositives: 1, outcome: 'treat' })
    await setTap('id-taps', 5, null, 3)
    expect((await getRun('id-taps'))?.outcome).toBeUndefined()
  })

  it('fails a refused run and keeps its taps as notes that never count', async () => {
    await addRun(run('failed', 7300))
    await saveRead('id-failed', regions, roles, read(Array(8).fill('held'), 'failed'), 3)
    for (const i of [2, 3, 4, 5]) await setTap('id-failed', i, 'pos', 3)
    const r = await getRun('id-failed')
    expect(r).toMatchObject({ outcome: 'failed', rule: { treatAt: 3 } })
    expect(r?.taps.filter((t) => t === 'pos')).toHaveLength(4)
    expect(r?.readerPositives).toBeUndefined()
    expect(r?.tappedPositives).toBeUndefined()
  })
})
