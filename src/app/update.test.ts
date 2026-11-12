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

afterEach(() => vi.unstubAllGlobals())

describe('the update bar', () => {
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
    const b = browser({ controlled: true, waiting: true, serving: __APP_BUILD__ })
    const { watchForUpdates, offered } = await load()
    watchForUpdates(b.reg)
    await flush()
    expect(b.waiting!.postMessage).not.toHaveBeenCalled()
    ;(await offered())!()
    expect(b.waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(b.reload).not.toHaveBeenCalled()
    b.fire('controllerchange')
    expect(b.reload).toHaveBeenCalledOnce()
  })
})
