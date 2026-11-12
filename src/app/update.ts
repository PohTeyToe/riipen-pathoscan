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
  let fallback: ReturnType<typeof setTimeout> | undefined
  // Reload decides what to do when tapped, not when offered, so it can't act on a version that has
  // since moved on: switch to the version waiting now, or, if none is waiting, just reload.
  const update = () => {
    const waiting = reg.waiting
    if (!waiting) return location.reload()
    asked = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
    // If that version never takes over (a newer one replaced it), reload anyway; the next check offers again.
    fallback = setTimeout(() => location.reload(), 3000)
  }
  // Checks can finish out of order. Each takes a number; an answer is dropped only if a later
  // check has already published one. A check that learns nothing publishes nothing.
  let started = 0
  let published = 0
  const publish = (mine: number, offer: boolean) => {
    if (mine < published) return
    published = mine
    set(offer ? update : null)
  }
  const check = async () => {
    const mine = ++started
    // With no controller this is the first install, not an update.
    if (!sw.controller) return
    if (reg.waiting) return publish(mine, true)
    const build = await servingBuild()
    if (build !== null) publish(mine, build !== __APP_BUILD__)
  }
  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    next?.addEventListener('statechange', check)
  })
  sw.addEventListener('controllerchange', () => {
    if (!asked) return void check()
    clearTimeout(fallback)
    location.reload()
  })
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
