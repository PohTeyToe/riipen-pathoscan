import 'fake-indexeddb/auto'
import { createStore, get, keys, set } from 'idb-keyval'
import { describe, expect, it, vi } from 'vitest'
import { sclerotinia } from './assays/sclerotinia'
import { currentStep, newRun, READER_VERSION, withStep } from './run'
import type { RunRead } from '../lib/readers'
import { ROLES } from './reader'
import { addRun, getPhoto, getRun, listRuns, NewerRun, retakePhoto, saveRead, setStepDone, setTap, startTimer, takePhoto } from './store'
import { remainingMs } from './timer'
import { currentUpdate } from './update'

const run = (field: string, createdAt: number) => newRun(sclerotinia, { field, notes: '' }, createdAt, `id-${field}`)

describe('a new run', () => {
  it('follows the schema-2 shape: no step started, ten empty taps, no outcome', () => {
    const r = newRun(sclerotinia, { field: '  North 40 ', notes: ' wet ' }, 5, 'a')
    expect(r).toMatchObject({ schema: 2, id: 'a', assay: 'sclerotinia', field: 'North 40', notes: 'wet', createdAt: 5, steps: {} })
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
  const [first, second] = sclerotinia.steps.map((s) => s.id)

  it('is the first step not done, and -1 once all are done', () => {
    let r = run('g', 1)
    expect(currentStep(r, sclerotinia)).toBe(0)
    r = withStep(withStep(r, first, { done: true }), second, { done: true })
    expect(currentStep(r, sclerotinia)).toBe(2)
    r = withStep(r, second, { done: false })
    expect(currentStep(r, sclerotinia)).toBe(1)
    r = sclerotinia.steps.reduce((acc, s) => withStep(acc, s.id, { done: true }), r)
    expect(currentStep(r, sclerotinia)).toBe(-1)
  })

  it('ends on the cool-down, timed by coolMin', () => {
    expect(sclerotinia.steps.at(-1)?.timerMin).toBe(sclerotinia.coolMin)
  })

  it('gives every step its own id', () => {
    expect(new Set(sclerotinia.steps.map((s) => s.id)).size).toBe(sclerotinia.steps.length)
  })

  it('keeps progress on its own step when the guide is reordered', () => {
    const r = withStep(withStep(run('order', 1), 'pick', { done: true }), 'preheat', { done: true, timerStartedAt: 7 })
    const reversed = { ...sclerotinia, steps: [...sclerotinia.steps].reverse() }
    expect(reversed.steps[currentStep(r, reversed)].id).toBe('cool')
    expect(reversed.steps.map((s) => r.steps[s.id]?.timerStartedAt)).toEqual(reversed.steps.map((s) => (s.id === 'preheat' ? 7 : undefined)))
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
    const step = sclerotinia.steps.find((s) => s.timerMin !== undefined)!
    await addRun(withStep(run('timer', 4000), step.id, { timerStartedAt: started }))
    const back = await getRun('id-timer')
    expect(back?.steps[step.id]?.timerStartedAt).toBe(started)
    expect(remainingMs(back!.steps[step.id]!.timerStartedAt!, step.timerMin!, started + 5 * 60_000)).toBe((step.timerMin! - 5) * 60_000)
  })

  it('marks a step done and undoes it', async () => {
    await addRun(run('step', 5000))
    await setStepDone('id-step', 'label', true)
    expect((await getRun('id-step'))?.steps.label?.done).toBe(true)
    await setStepDone('id-step', 'label', false)
    expect((await getRun('id-step'))?.steps.label?.done).toBe(false)
  })

  it('keeps the first timer start', async () => {
    await addRun(run('first', 5000))
    await startTimer('id-first', 'preheat', 111)
    await startTimer('id-first', 'preheat', 222)
    expect((await getRun('id-first'))?.steps.preheat?.timerStartedAt).toBe(111)
  })

  it('refuses a change to a run that is not there, and writes nothing', async () => {
    await expect(setStepDone('id-nope', 'label', true)).rejects.toThrow()
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
    await tabA.setStepDone('id-tabs', 'pick', true)
    await tabA.setStepDone('id-tabs', 'preheat', true)
    expect(seenByB?.steps.pick).toBeUndefined() // B's screen is now stale

    await tabB.startTimer('id-tabs', 'label', 333)
    await tabB.setStepDone('id-tabs', 'pick', true)
    const stored = await tabA.getRun('id-tabs')
    expect(['pick', 'preheat', 'label'].map((s) => stored?.steps[s]?.done)).toEqual([true, true, false])
    expect(stored?.steps.label?.timerStartedAt).toBe(333)
  })
})

describe('a run saved by the 8-step guide (schema 1)', () => {
  const db = createStore('pathoscan-field', 'runs')
  const t = 1_700_000_000_000
  // As the app stored it before step ids: progress by position in preheat, label, mix, crush, dip, oil, shade, cool.
  // Pre-heat and oil timers ran, and the cool-down's timer is running.
  const old = {
    ...run('saved', 900),
    schema: 1,
    steps: [
      { done: true, timerStartedAt: t },
      ...Array(4).fill({ done: true }),
      { done: true, timerStartedAt: t + 60 * 60_000 },
      { done: true },
      { done: false, timerStartedAt: t + 95 * 60_000 },
    ],
  }

  it('opens on the cool-down, with each timer on its own step', async () => {
    await set(old.id, old, db)
    const r = (await getRun(old.id))!
    expect(r.schema).toBe(2)
    expect(sclerotinia.steps[currentStep(r, sclerotinia)].id).toBe('cool')
    expect(r.steps.cool).toEqual({ done: false, timerStartedAt: t + 95 * 60_000 })
    const timers = Object.fromEntries(sclerotinia.steps.map((s) => [s.id, r.steps[s.id]?.timerStartedAt]))
    expect(timers).toEqual({ pick: undefined, preheat: t, label: undefined, mix: undefined, crush: undefined, dip: undefined, oil: t + 60 * 60_000, shade: undefined, cool: t + 95 * 60_000 })
    expect((await listRuns()).find((x) => x.id === old.id)?.steps).toEqual(r.steps)
  })

  it('is stored in the new shape at its next change, progress intact', async () => {
    await set(old.id, old, db)
    await setStepDone(old.id, 'cool', true)
    const stored = await get(old.id, db)
    expect(stored).toMatchObject({ schema: 2, steps: { preheat: { done: true, timerStartedAt: t }, cool: { done: true, timerStartedAt: t + 95 * 60_000 } } })
    expect(currentStep(stored, sclerotinia)).toBe(-1)
  })

  it('starts at picking the samples if the run had not begun', async () => {
    await set('id-fresh', { ...old, id: 'id-fresh', steps: Array(8).fill({ done: false }) }, db)
    expect(currentStep((await getRun('id-fresh'))!, sclerotinia)).toBe(0)
  })
})

describe('a run saved by a newer app (another tab already updated)', () => {
  it('is left alone, unread and unwritten, and Reload is offered', async () => {
    const db = createStore('pathoscan-field', 'runs')
    const future = { schema: 3, id: 'id-future', createdAt: 99_000, steps: 'a shape this app has never seen' }
    await set(future.id, future, db)
    expect(currentUpdate()).toBeNull()
    await expect(getRun(future.id)).rejects.toBeInstanceOf(NewerRun)
    expect(currentUpdate()).toBeInstanceOf(Function)
    expect((await listRuns()).map((r) => r.id)).not.toContain(future.id)
    await expect(setStepDone(future.id, 'pick', true)).rejects.toBeInstanceOf(NewerRun)
    await expect(startTimer(future.id, 'preheat', 1)).rejects.toBeInstanceOf(NewerRun)
    expect(await get(future.id, db)).toEqual(future)
  })

  it('is told apart from a missing run and from a failed read, even once Reload is offered', async () => {
    expect(currentUpdate()).not.toBeNull() // offered by the test before
    expect(await getRun('id-never-saved')).toBeUndefined()
    const broken = new DOMException('The disk is unreadable', 'UnknownError')
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw broken
    })
    try {
      await expect(getRun('id-future')).rejects.toBe(broken)
    } finally {
      read.mockRestore()
    }
  })
})

describe('the read and the taps', () => {
  const roles = ROLES
  const read = (samples: ('pos' | 'neg' | 'held')[], status: RunRead['status'] = 'ok'): RunRead => ({
    status,
    flags: [],
    tubes: [{ call: 'pos', reason: '' }, { call: 'neg', reason: '' }, ...samples.map((call) => ({ call, reason: '' }))],
  })
  const regions = roles.map((_, i) => ({ x0: i, y0: 0, x1: i + 1, y1: 1, cx: i, cy: 0 }))
  const twoHeld = read(['pos', 'pos', 'held', 'held', 'neg', 'neg', 'neg', 'neg'])

  const jpeg = (text: string) => new Blob([text], { type: 'image/jpeg' })
  /** A run with a photo and a read, as the Photo screen leaves it. */
  const readRun = async (name: string, at: number, r = twoHeld) => {
    await addRun(run(name, at))
    const key = (await takePhoto(`id-${name}`, jpeg('first')))!
    expect(await saveRead(`id-${name}`, key, regions, roles, r, 3)).toBe(true)
    return key
  }

  it('keeps each photo under its own key, and a retake replaces and deletes the one before', async () => {
    await addRun(run('photo', 7000))
    const first = (await takePhoto('id-photo', jpeg('first')))!
    expect(first).toMatch(/^id-photo\//)
    expect((await getRun('id-photo'))?.photoKey).toBe(first)
    const second = (await takePhoto('id-photo', jpeg('second')))!
    expect(second).not.toBe(first)
    expect((await getRun('id-photo'))?.photoKey).toBe(second)
    expect(await getPhoto(first)).toBeUndefined()
    expect(await (await getPhoto(second))!.text()).toBe('second')
  })

  it('deletes the photo it saved when the run update fails', async () => {
    // A run deleted meanwhile makes the update reject, as a full disk (QuotaExceededError) would.
    await expect(takePhoto('id-gone', jpeg('orphan'))).rejects.toThrow()
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith('id-gone/'))).toEqual([])
  })

  it('stores the read with its count and outcome, and the first read wins', async () => {
    const key = await readRun('read', 7100)
    expect(await saveRead('id-read', key, regions, roles, read(Array(8).fill('pos')), 3)).toBe(false)
    const r = await getRun('id-read')
    expect(r).toMatchObject({ photoKey: key, read: twoHeld, roles, regions, readerPositives: 2, tappedPositives: 0, rule: { treatAt: 3 }, readerVersion: READER_VERSION })
    expect(r?.outcome).toBeUndefined()
  })

  it("won't let a stale tab retake a run another tab has read: its photo is dropped, the read one kept", async () => {
    vi.resetModules()
    const tabB = await import('./store')
    const key = await readRun('stale', 7150) // tab A takes, rings and reads the run
    expect(await tabB.takePhoto('id-stale', jpeg('late'))).toBeNull()
    const r = await getRun('id-stale')
    expect(r).toMatchObject({ photoKey: key, read: twoHeld })
    expect(await (await getPhoto(key))!.text()).toBe('first')
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith('id-stale/'))).toEqual([key])
  })

  it('refuses a read of a photo another tab has since replaced', async () => {
    vi.resetModules()
    const tabB = await import('./store')
    await addRun(run('swap', 7160))
    const a = (await takePhoto('id-swap', jpeg('a')))!
    const b = (await tabB.takePhoto('id-swap', jpeg('b')))!
    expect(await saveRead('id-swap', a, regions, roles, twoHeld, 3)).toBe(false) // tab A's rings were on photo a
    expect((await getRun('id-swap'))?.read).toBeUndefined()
    expect(await tabB.saveRead('id-swap', b, regions, roles, twoHeld, 3)).toBe(true)
    expect((await getRun('id-swap'))?.photoKey).toBe(b)
  })

  it('goes back to the photo step for a retake: the photo, its read and the taps go, the guide progress stays', async () => {
    const key = await readRun('retake', 7170)
    await setStepDone('id-retake', 'cool', true)
    await setTap('id-retake', 4, 'pos', 3)
    expect(await retakePhoto('id-retake', key)).toBe(true)
    const r = (await getRun('id-retake'))!
    for (const k of ['photoKey', 'regions', 'roles', 'read', 'readerPositives', 'tappedPositives', 'rule', 'outcome']) expect(r).not.toHaveProperty(k)
    expect(r.taps).toEqual(Array(10).fill(null))
    expect(r.steps.cool).toEqual({ done: true })
    expect(r.field).toBe('retake')
    expect(await getPhoto(key)).toBeUndefined()
    // The new photo is read as a first one would be.
    const next = (await takePhoto('id-retake', jpeg('second')))!
    expect(await saveRead('id-retake', next, regions, roles, twoHeld, 3)).toBe(true)
  })

  it('refuses a retake from a stale tab once another tab has a new photo on the run', async () => {
    const key = await readRun('retake2', 7180)
    expect(await retakePhoto('id-retake2', key)).toBe(true)
    const next = (await takePhoto('id-retake2', jpeg('second')))!
    expect(await retakePhoto('id-retake2', key)).toBe(false)
    expect((await getRun('id-retake2'))?.photoKey).toBe(next)
    expect(await (await getPhoto(next))!.text()).toBe('second')
  })

  it("keeps taps apart from the read and recounts, without losing a stale tab's tap", async () => {
    await readRun('taps', 7200)
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
    await readRun('failed', 7300, read(Array(8).fill('held'), 'failed'))
    for (const i of [2, 3, 4, 5]) await setTap('id-failed', i, 'pos', 3)
    const r = await getRun('id-failed')
    expect(r).toMatchObject({ outcome: 'failed', rule: { treatAt: 3 } })
    expect(r?.taps.filter((t) => t === 'pos')).toHaveLength(4)
    expect(r?.readerPositives).toBeUndefined()
    expect(r?.tappedPositives).toBeUndefined()
  })
})
