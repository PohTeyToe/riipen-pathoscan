import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the browser pieces update.ts touches: one registration, one controller, the version file.
function browser(opts: { controlled: boolean; waiting?: boolean; serving: string | null }) {
  const listeners: Record<string, (() => void)[]> = {}
  const on = (t: string, f: () => void) => (listeners[t] ??= []).push(f)
  const waiting = opts.waiting ? { postMessage: vi.fn() } : null
  const reg = { waiting, installing: null, addEventListener: on, update: vi.fn(() => Promise.resolve()) }
  const reload = vi.fn()
  vi.stubGlobal('navigator', { serviceWorker: { controller: opts.controlled ? {} : null, addEventListener: on } })
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: on })
  vi.stubGlobal('location', { reload })
  vi.stubGlobal('fetch', vi.fn(async () => (opts.serving === null ? { ok: false } : { ok: true, json: async () => ({ build: opts.serving }) })))
  return { reg: reg as unknown as ServiceWorkerRegistration, waiting, reload, fire: (t: string) => listeners[t]?.forEach((f) => f()) }
}

async function load() {
  vi.resetModules()
  const m = await import('./update')
  return { watchForUpdates: m.watchForUpdates, offered: async () => m.currentUpdate() }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.clearAllTimers() // the 3 s reload fallback must not fire after its test's stubs are gone
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the update bar', () => {
  it('keeps a newer offer when an older version check answers late', async () => {
    const b = browser({ controlled: true, serving: __APP_BUILD__ })
    let answer!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (answer = r))))
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg) // check 1 waits on the version file
    // Build 2 finishes installing; its check sees it waiting and offers it.
    ;(b.reg as unknown as { waiting: unknown }).waiting = { postMessage: vi.fn() }
    b.fire('controllerchange')
    await flush()
    expect(await offered()).not.toBeNull()
    answer({ ok: true, json: async () => ({ build: __APP_BUILD__ }) }) // check 1 answers: same build
    await flush()
    expect(await offered()).not.toBeNull()
  })

  it('keeps an offer when a later version check cannot read the file', async () => {
    const b = browser({ controlled: true, serving: 'newer' })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await flush()
    expect(await offered()).not.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    b.fire('visibilitychange')
    await flush()
    expect(await offered()).not.toBeNull()
  })

  it('takes a late newer-build answer when the check after it could not read the file', async () => {
    const b = browser({ controlled: true, serving: __APP_BUILD__ })
    let answer!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (answer = r))))
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg) // check 1 waits
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    b.fire('visibilitychange') // check 2 fails at once
    await flush()
    answer({ ok: true, json: async () => ({ build: 'newer' }) })
    await flush()
    expect(await offered()).not.toBeNull()
  })

  it('reloads on tap when the offered waiting version was activated elsewhere in the meantime', async () => {
    const b = browser({ controlled: true, waiting: true, serving: __APP_BUILD__ })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await flush()
    const apply = await offered()
    ;(b.reg as unknown as { waiting: unknown }).waiting = null // another tab switched to it
    apply!()
    expect(b.waiting!.postMessage).not.toHaveBeenCalled()
    expect(b.reload).toHaveBeenCalledOnce()
  })

  it('reloads anyway when the waiting version never takes over after the tap', async () => {
    vi.useFakeTimers()
    try {
      const b = browser({ controlled: true, waiting: true, serving: __APP_BUILD__ })
      const { watchForUpdates, offered } = await load()
      watchForUpdates(b.reg)
      await vi.advanceTimersByTimeAsync(0)
      ;(await offered())!()
      expect(b.reload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3000)
      expect(b.reload).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers Reload when another tab already switched this page to a newer build', async () => {
    const b = browser({ controlled: true, serving: 'newer' })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await flush()
    const apply = await offered()
    expect(apply).not.toBeNull()
    apply!()
    expect(b.reload).toHaveBeenCalledOnce()
  })

  it('stays quiet when the serving build is this page’s build', async () => {
    const b = browser({ controlled: true, serving: __APP_BUILD__ })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await flush()
    expect(await offered()).toBeNull()
  })

  it('stays quiet on first install and when the version file cannot be read', async () => {
    for (const b of [browser({ controlled: false, serving: 'newer' }), browser({ controlled: true, serving: null })]) {
      const { watchForUpdates, offered } = await load()
      watchForUpdates(b.reg)
      await flush()
      expect(await offered()).toBeNull()
    }
  })

  it('switches a waiting build only on the tap, then reloads when it takes over', async () => {
    vi.useFakeTimers()
    const b = browser({ controlled: true, waiting: true, serving: __APP_BUILD__ })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await vi.advanceTimersByTimeAsync(0)
    expect(b.waiting!.postMessage).not.toHaveBeenCalled()
    ;(await offered())!()
    expect(b.waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(b.reload).not.toHaveBeenCalled()
    b.fire('controllerchange')
    expect(b.reload).toHaveBeenCalledOnce()
  })
})
