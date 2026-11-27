import 'fake-indexeddb/auto'
import { createStore, get, keys, set } from 'idb-keyval'
import { describe, expect, it, vi } from 'vitest'
import { sclerotinia } from './assays/sclerotinia'
import { currentStep, newRun, READER_VERSION, SCHEMA, withStep } from './run'
import type { RunRead } from '../lib/readers'
import { ROLES } from './reader'
import { addRun, getPhoto, getRun, listRuns, NewerRun, retakePhoto, saveRead, setStepDone, setTap, startTimer, takePhoto, type Seen } from './store'
import { remainingMs } from './timer'
import { currentUpdate } from './update'

const run = (field: string, createdAt: number) => newRun(sclerotinia, { field, notes: '' }, createdAt, `id-${field}`)
/** A screen of run `id` drawn on photo take `take`. */
const on = (id: string, take = 0): Seen => ({ id, take })

describe('a new run', () => {
  it('follows the schema-5 shape: no step started, no photo taken, no taps until the read says how many tubes, no outcome', () => {
    const r = newRun(sclerotinia, { field: '  North 40 ', notes: ' wet ' }, 5, 'a')
    expect(SCHEMA).toBe(5)
    expect(r).toMatchObject({ schema: SCHEMA, take: 0, id: 'a', assay: 'sclerotinia', field: 'North 40', notes: 'wet', createdAt: 5, steps: {} })
    expect(r.taps).toEqual([])
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
    expect(await setStepDone(on('id-step'), 'label', true)).toBe(true)
    expect((await getRun('id-step'))?.steps.label?.done).toBe(true)
    await setStepDone(on('id-step'), 'label', false)
    expect((await getRun('id-step'))?.steps.label?.done).toBe(false)
  })

  it('keeps the first timer start', async () => {
    await addRun(run('first', 5000))
    expect(await startTimer(on('id-first'), 'preheat', 111)).toBe(true)
    expect(await startTimer(on('id-first'), 'preheat', 222)).toBe(false)
    expect((await getRun('id-first'))?.steps.preheat?.timerStartedAt).toBe(111)
  })

  it('refuses a change to a run that is not there, and writes nothing', async () => {
    await expect(setStepDone(on('id-nope'), 'label', true)).rejects.toThrow()
    expect(await getRun('id-nope')).toBeUndefined()
  })

  it("keeps one tab's progress when a stale second tab writes on the same take", async () => {
    // Two tabs: two separate connections to the same database.
    const tabA = { addRun, getRun, setStepDone, startTimer }
    vi.resetModules()
    const tabB = await import('./store')
    expect(tabB.getRun).not.toBe(tabA.getRun)

    await tabA.addRun(run('tabs', 6000))
    const seenByB = (await tabB.getRun('id-tabs'))!
    await tabA.setStepDone(on('id-tabs'), 'pick', true)
    await tabA.setStepDone(on('id-tabs'), 'preheat', true)
    expect(seenByB.steps.pick).toBeUndefined() // B's screen is now stale

    await tabB.startTimer(seenByB, 'label', 333)
    await tabB.setStepDone(seenByB, 'pick', true)
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
  const { take: _take, ...fields } = run('saved', 900)
  const old = {
    ...fields,
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
    expect(r).toMatchObject({ schema: SCHEMA, take: 0 })
    expect(sclerotinia.steps[currentStep(r, sclerotinia)].id).toBe('cool')
    expect(r.steps.cool).toEqual({ done: false, timerStartedAt: t + 95 * 60_000 })
    const timers = Object.fromEntries(sclerotinia.steps.map((s) => [s.id, r.steps[s.id]?.timerStartedAt]))
    expect(timers).toEqual({ pick: undefined, preheat: t, label: undefined, mix: undefined, crush: undefined, dip: undefined, oil: t + 60 * 60_000, shade: undefined, cool: t + 95 * 60_000 })
    expect((await listRuns()).find((x) => x.id === old.id)?.steps).toEqual(r.steps)
  })

  it('is stored in the new shape once opened, progress intact', async () => {
    await set(old.id, old, db)
    await getRun(old.id)
    expect(await get(old.id, db)).toMatchObject({ schema: SCHEMA, take: 0, steps: { preheat: { done: true, timerStartedAt: t }, cool: { done: false, timerStartedAt: t + 95 * 60_000 } } })
    await setStepDone(on(old.id), 'cool', true)
    const stored = await get(old.id, db)
    expect(stored).toMatchObject({ schema: SCHEMA, steps: { preheat: { done: true, timerStartedAt: t }, cool: { done: true, timerStartedAt: t + 95 * 60_000 } } })
    expect(currentStep(stored, sclerotinia)).toBe(-1)
  })

  it('starts at picking the samples if the run had not begun', async () => {
    await set('id-fresh', { ...old, id: 'id-fresh', steps: Array(8).fill({ done: false }) }, db)
    expect(currentStep((await getRun('id-fresh'))!, sclerotinia)).toBe(0)
  })
})

describe('a run saved by the app before photo takes (schema 2)', () => {
  const db = createStore('pathoscan-field', 'runs')
  // As that app stored a run with a photo: the current shape without `take`.
  const { take: _take, ...fields } = run('two', 950)
  const old = { ...fields, schema: 2, photoKey: 'id-two/p' }

  it('is listed without being stored again', async () => {
    await set(old.id, old, db)
    expect((await listRuns()).find((r) => r.id === old.id)).toEqual({ ...old, schema: SCHEMA, take: 0 })
    expect(await get(old.id, db)).toEqual(old)
  })

  it('is stored on its first take once opened, out of reach of the older app', async () => {
    await set(old.id, old, db)
    const r = (await getRun(old.id))!
    expect(r).toEqual({ ...old, schema: SCHEMA, take: 0 })
    // 8ea660e's store refuses, before any edit, a run whose schema is over its own 2 (e2e covers that store).
    expect(await get(old.id, db)).toEqual(r)
    expect(await getRun(old.id)).toEqual(r)
  })
})

// Schema 3: the app that took a threshold on every tap. Schema 4: the app that read only ten-tube runs.
describe.each([3, 4])('a run saved by the schema-%i app', (schema) => {
  it('is stored as the current schema once opened, with nothing else changed, out of reach of that app', async () => {
    const db = createStore('pathoscan-field', 'runs')
    const old = { ...run(`schema-${schema}`, 960), schema, take: 1, photoKey: `id-schema-${schema}/p`, taps: Array(10).fill(null) }
    await set(old.id, old, db)
    expect((await listRuns()).find((r) => r.id === old.id)).toEqual({ ...old, schema: SCHEMA })
    expect(await get(old.id, db)).toEqual(old)
    const r = (await getRun(old.id))!
    expect(r).toEqual({ ...old, schema: SCHEMA })
    // That app's store refuses, before any edit, a run whose schema is over its own, as 8ea660e's does over 2.
    expect(await get(old.id, db)).toEqual(r)
  })
})

describe('a run saved by a newer app (another tab already updated)', () => {
  it('is left alone, unread and unwritten, and Reload is offered', async () => {
    const db = createStore('pathoscan-field', 'runs')
    const future = { schema: SCHEMA + 1, id: 'id-future', createdAt: 99_000, steps: 'a shape this app has never seen' }
    await set(future.id, future, db)
    expect(currentUpdate()).toBeNull()
    await expect(getRun(future.id)).rejects.toBeInstanceOf(NewerRun)
    expect(currentUpdate()).toBeInstanceOf(Function)
    expect((await listRuns()).map((r) => r.id)).not.toContain(future.id)
    // Every write, whichever take it names.
    for (const take of [0, 1, 7]) {
      const seen = on(future.id, take)
      await expect(setStepDone(seen, 'pick', true)).rejects.toBeInstanceOf(NewerRun)
      await expect(startTimer(seen, 'preheat', 1)).rejects.toBeInstanceOf(NewerRun)
      await expect(takePhoto(seen, new Blob(['x']))).rejects.toBeInstanceOf(NewerRun)
      await expect(saveRead(seen, [], [], { status: 'ok', flags: [], tubes: [] }, 3)).rejects.toBeInstanceOf(NewerRun)
      await expect(retakePhoto(seen)).rejects.toBeInstanceOf(NewerRun)
      await expect(setTap(seen, 2, 'pos')).rejects.toBeInstanceOf(NewerRun)
    }
    expect(await get(future.id, db)).toEqual(future)
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith(`${future.id}/`))).toEqual([])
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
  /** A run with a photo and a read, as the Photo screen leaves it: the result screen's view of it. */
  const readRun = async (name: string, at: number, r = twoHeld) => {
    await addRun(run(name, at))
    const id = `id-${name}`
    expect(await takePhoto(on(id), jpeg('first'))).not.toBeNull()
    expect(await saveRead(on(id, 1), regions, roles, r, 3)).toBe(true)
    return (await getRun(id))!
  }

  it('keeps each photo under its own key, and a new photo replaces and deletes the one before, each a new take', async () => {
    await addRun(run('photo', 7000))
    const first = (await takePhoto(on('id-photo'), jpeg('first')))!
    expect(first).toMatch(/^id-photo\//)
    expect(await getRun('id-photo')).toMatchObject({ photoKey: first, take: 1 })
    const second = (await takePhoto(on('id-photo', 1), jpeg('second')))!
    expect(second).not.toBe(first)
    expect(await getRun('id-photo')).toMatchObject({ photoKey: second, take: 2 })
    expect(await getPhoto(first)).toBeUndefined()
    expect(await (await getPhoto(second))!.text()).toBe('second')
  })

  it('deletes the photo it saved when the run update fails', async () => {
    // A run deleted meanwhile makes the update reject, as a full disk (QuotaExceededError) would.
    await expect(takePhoto(on('id-gone'), jpeg('orphan'))).rejects.toThrow()
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith('id-gone/'))).toEqual([])
  })

  it('stores the read with its count and outcome, and the first read wins', async () => {
    const seen = await readRun('read', 7100)
    expect(await saveRead(seen, regions, roles, read(Array(8).fill('pos')), 3)).toBe(false)
    const r = await getRun('id-read')
    expect(r).toMatchObject({ take: 1, read: twoHeld, roles, regions, readerPositives: 2, tappedPositives: 0, rule: { treatAt: 3 }, readerVersion: READER_VERSION })
    expect(r?.outcome).toBeUndefined()
  })

  it("won't let a stale tab photograph a run another tab has read: its photo is dropped, the read one kept", async () => {
    vi.resetModules()
    const tabB = await import('./store')
    const seen = await readRun('stale', 7150) // tab A takes, rings and reads the run
    // B's Photo screen, on A's photo before the read, or on none before A took it.
    for (const take of [1, 0]) expect(await tabB.takePhoto(on('id-stale', take), jpeg('late'))).toBeNull()
    expect(await getRun('id-stale')).toEqual(seen)
    expect(await (await getPhoto(seen.photoKey!))!.text()).toBe('first')
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith('id-stale/'))).toEqual([seen.photoKey])
  })

  it('refuses a read of a photo another tab has since replaced', async () => {
    vi.resetModules()
    const tabB = await import('./store')
    await addRun(run('swap', 7160))
    expect(await takePhoto(on('id-swap'), jpeg('a'))).not.toBeNull()
    const b = (await tabB.takePhoto(on('id-swap', 1), jpeg('b')))!
    expect(await saveRead(on('id-swap', 1), regions, roles, twoHeld, 3)).toBe(false) // tab A's rings were on photo a
    expect((await getRun('id-swap'))?.read).toBeUndefined()
    expect(await tabB.saveRead(on('id-swap', 2), regions, roles, twoHeld, 3)).toBe(true)
    expect((await getRun('id-swap'))?.photoKey).toBe(b)
  })

  it('goes back to the photo step for a retake: the photo, its read and the taps go, the guide progress stays', async () => {
    await addRun(run('retake', 7170))
    await setStepDone(on('id-retake'), 'cool', true)
    const key = (await takePhoto(on('id-retake'), jpeg('first')))!
    expect(await saveRead(on('id-retake', 1), regions, roles, twoHeld, 3)).toBe(true)
    expect(await setTap(on('id-retake', 1), 4, 'pos')).toBe(true)
    expect(await retakePhoto(on('id-retake', 1))).toBe(true)
    const r = (await getRun('id-retake'))!
    for (const k of ['photoKey', 'regions', 'roles', 'read', 'readerPositives', 'tappedPositives', 'rule', 'outcome']) expect(r).not.toHaveProperty(k)
    expect(r.take).toBe(2)
    expect(r.taps).toEqual([])
    expect(r.steps.cool).toEqual({ done: true })
    expect(r.field).toBe('retake')
    expect(await getPhoto(key)).toBeUndefined()
    // The new photo is read as a first one would be.
    expect(await takePhoto(r, jpeg('second'))).not.toBeNull()
    expect(await saveRead(on('id-retake', 3), regions, roles, twoHeld, 3)).toBe(true)
  })

  it('refuses a retake from a stale tab once another tab has a new photo on the run', async () => {
    const seen = await readRun('retake2', 7180)
    expect(await retakePhoto(seen)).toBe(true)
    const next = (await takePhoto(on('id-retake2', 2), jpeg('second')))!
    expect(await retakePhoto(seen)).toBe(false)
    expect((await getRun('id-retake2'))?.photoKey).toBe(next)
    expect(await (await getPhoto(next))!.text()).toBe('second')
  })

  it("keeps taps apart from the read and recounts, without losing a stale tab's tap", async () => {
    const seen = await readRun('taps', 7200)
    vi.resetModules()
    const tabB = await import('./store')
    await setTap(seen, 4, 'neg')
    await tabB.setTap(seen, 5, 'pos') // B never saw A's tap
    const r = await getRun('id-taps')
    expect(r?.taps.slice(4, 6)).toEqual(['neg', 'pos'])
    expect(r?.read).toEqual(twoHeld)
    expect(r).toMatchObject({ readerPositives: 2, tappedPositives: 1, outcome: 'treat' })
    await setTap(seen, 5, null)
    expect((await getRun('id-taps'))?.outcome).toBeUndefined()
  })

  it("keeps the rule a run was read under through every tap, and reads a new run under the assay's rule", async () => {
    // Read at 3: two positives, so a held tube decides it. The assay's rule is 2 now.
    const seen = await readRun('old-rule', 7230)
    expect(seen).toMatchObject({ rule: { treatAt: 3 } })
    expect(await setTap(seen, 4, 'neg')).toBe(true)
    expect(await getRun('id-old-rule')).toMatchObject({ rule: { treatAt: 3 }, tappedPositives: 0 })
    expect((await getRun('id-old-rule'))?.outcome).toBeUndefined() // tube 4 still open
    expect(await setTap(seen, 5, 'neg')).toBe(true)
    expect(await getRun('id-old-rule')).toMatchObject({ rule: { treatAt: 3 }, outcome: 'dont-treat' })
    expect(await setTap(seen, 5, 'pos')).toBe(true)
    expect(await getRun('id-old-rule')).toMatchObject({ rule: { treatAt: 3 }, tappedPositives: 1, outcome: 'treat' })

    await addRun(run('new-rule', 7240))
    expect(await takePhoto(on('id-new-rule'), jpeg('first'))).not.toBeNull()
    expect(await saveRead(on('id-new-rule', 1), regions, roles, twoHeld, sclerotinia.rule!.treatAt)).toBe(true)
    expect(await getRun('id-new-rule')).toMatchObject({ rule: { treatAt: 2 }, readerPositives: 2, outcome: 'treat' })
    expect(await setTap(on('id-new-rule', 1), 4, 'neg')).toBe(true)
    expect(await getRun('id-new-rule')).toMatchObject({ rule: { treatAt: 2 }, outcome: 'treat' })
  })

  it('reads a run of fewer samples with no rule: a call per tube, no advice until every held tube is called', async () => {
    await addRun(run('short', 7245))
    expect(await takePhoto(on('id-short'), jpeg('first'))).not.toBeNull()
    const short = read(['pos', 'held', 'neg', 'neg', 'neg', 'neg'])
    const six = roles.slice(0, 8)
    expect(await saveRead(on('id-short', 1), regions.slice(0, 8), six, short, undefined)).toBe(true)
    const r = (await getRun('id-short'))!
    expect(r).toMatchObject({ roles: six, taps: Array(8).fill(null), readerPositives: 1, tappedPositives: 0 })
    expect(r.rule).toBeUndefined()
    expect(r.outcome).toBeUndefined()
    expect(await setTap(r, 3, 'pos')).toBe(true)
    expect(await getRun('id-short')).toMatchObject({ readerPositives: 1, tappedPositives: 1, outcome: 'no-advice' })
  })

  it('refuses a tap on a tube the reader called', async () => {
    const seen = await readRun('called', 7250)
    expect(await setTap(seen, 2, 'neg')).toBe(false) // sample 1 read positive
    expect((await getRun('id-called'))?.taps).toEqual(Array(10).fill(null))
  })

  it("refuses a stale tab's tap on the result of a photo since retaken, so the new photo's result stands", async () => {
    // Tab B still shows the first photo's result; tab A retakes and reads a new photo with sample 1 held.
    const old = await readRun('stale-tap', 7260, read(Array(8).fill('held')))
    vi.resetModules()
    const tabB = await import('./store')
    expect(await retakePhoto(old)).toBe(true)
    expect(await takePhoto(on('id-stale-tap', 2), jpeg('second'))).not.toBeNull()
    expect(await saveRead(on('id-stale-tap', 3), regions, roles, twoHeld, 3)).toBe(true)
    const before = (await getRun('id-stale-tap'))!
    expect(await tabB.setTap(old, 4, 'pos')).toBe(false)
    expect(await getRun('id-stale-tap')).toEqual(before)
    expect(before).toMatchObject({ readerPositives: 2, tappedPositives: 0 })
    expect(before.outcome).toBeUndefined()
    // A tap on the result on show still counts.
    expect(await setTap(before, 4, 'pos')).toBe(true)
    expect(await getRun('id-stale-tap')).toMatchObject({ tappedPositives: 1, outcome: 'treat' })
  })

  it("won't let a stale tab reopen or time a step of a run another tab has read", async () => {
    await addRun(run('stale-step', 7270))
    await setStepDone(on('id-stale-step'), 'cool', true)
    expect(await takePhoto(on('id-stale-step'), jpeg('first'))).not.toBeNull()
    expect(await saveRead(on('id-stale-step', 1), regions, roles, twoHeld, 3)).toBe(true)
    const before = await getRun('id-stale-step')
    expect(await setStepDone(on('id-stale-step', 1), 'cool', false)).toBe(false) // Back on a stale photo screen
    expect(await startTimer(on('id-stale-step', 1), 'preheat', 1)).toBe(false)
    expect(await getRun('id-stale-step')).toEqual(before)
  })

  it("won't let a screen drawn before another tab's retake reopen, time or photograph the run retaken since", async () => {
    // Tab B's screens: the last step before any photo (take 0), and the Photo screen with the first photo (take 1).
    // Tab A reads that photo, then retakes it: the run is back on the photo step, on take 2.
    vi.resetModules()
    const tabB = await import('./store')
    await addRun(run('stale-guide', 7280))
    await setStepDone(on('id-stale-guide'), 'cool', true)
    expect(await takePhoto(on('id-stale-guide'), jpeg('first'))).not.toBeNull()
    expect(await saveRead(on('id-stale-guide', 1), regions, roles, twoHeld, 3)).toBe(true)
    expect(await retakePhoto(on('id-stale-guide', 1))).toBe(true)
    const before = (await getRun('id-stale-guide'))!
    expect(before).toMatchObject({ take: 2, steps: { cool: { done: true } } })
    for (const stale of [on('id-stale-guide', 0), on('id-stale-guide', 1)]) {
      expect(await tabB.setStepDone(stale, 'cool', false)).toBe(false) // Back
      expect(await tabB.setStepDone(stale, 'shade', true)).toBe(false)
      expect(await tabB.startTimer(stale, 'preheat', 1)).toBe(false)
      expect(await tabB.takePhoto(stale, jpeg('late'))).toBeNull()
    }
    expect(await getRun('id-stale-guide')).toEqual(before)
    const saved = await keys(createStore('pathoscan-photos', 'photos'))
    expect(saved.filter((k) => String(k).startsWith('id-stale-guide/'))).toEqual([])
    // A screen drawn since can go back.
    expect(await tabB.setStepDone(before, 'cool', false)).toBe(true)
    expect((await getRun('id-stale-guide'))?.steps.cool?.done).toBe(false)
  })

  it('fails a refused run and keeps its taps as notes that never count', async () => {
    const seen = await readRun('failed', 7300, read(Array(8).fill('held'), 'failed'))
    for (const i of [2, 3, 4, 5]) await setTap(seen, i, 'pos')
    const r = await getRun('id-failed')
    expect(r).toMatchObject({ outcome: 'failed', rule: { treatAt: 3 } })
    expect(r?.taps.filter((t) => t === 'pos')).toHaveLength(4)
    expect(r?.readerPositives).toBeUndefined()
    expect(r?.tappedPositives).toBeUndefined()
  })
})
