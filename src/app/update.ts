// A new version installs in the background and waits. It takes over only when the grower taps
// Reload, never on its own: an open page may still ask for files that only the old version cached.
//
// One check decides whether to offer Reload, so no lifecycle event can slip past it:
// - a new version is waiting: Reload switches to it, then reloads;
// - the version now serving this page's files differs from the one this page was built as (another tab
//   already switched): Reload just reloads.
// The serving version comes from app-version.json, which the service worker precaches with the rest.

import { useSyncExternalStore } from 'react'

let apply: (() => void) | null = null
const subs = new Set<() => void>()
const set = (f: (() => void) | null) => {
  apply = f
  subs.forEach((s) => s())
}

async function servingBuild(): Promise<string | null> {
  try {
    const res = await fetch('/app-version.json')
    return res.ok ? ((await res.json()) as { build: string }).build : null
  } catch {
    return null
  }
}

export function watchForUpdates(reg: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker
  let asked = false
  // Checks can finish out of order. Each takes a number; an answer is dropped only if a later
  // check has already published one. A check that learns nothing publishes nothing.
  let started = 0
  let published = 0
  const publish = (mine: number, f: (() => void) | null) => {
    if (mine < published) return
    published = mine
    set(f)
  }
  const check = async () => {
    const mine = ++started
    // With no controller this is the first install, not an update.
    if (!sw.controller) return
    const waiting = reg.waiting
    if (waiting)
      return publish(mine, () => {
        asked = true
        waiting.postMessage({ type: 'SKIP_WAITING' })
      })
    const build = await servingBuild()
    if (build !== null) publish(mine, build !== __APP_BUILD__ ? () => location.reload() : null)
  }
  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    next?.addEventListener('statechange', check)
  })
  sw.addEventListener('controllerchange', () => (asked ? location.reload() : void check()))
  // An installed app can stay open for days; look for a new version each time it comes back into view.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void check()
    reg.update().catch(() => {})
  })
  void check()
}

/** The action that switches to the newer version, or null when there is none. */
export const currentUpdate = () => apply

export const useUpdate = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    currentUpdate,
  )
