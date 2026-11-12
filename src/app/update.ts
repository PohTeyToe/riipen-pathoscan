// A new version installs in the background and waits. It takes over only when the grower taps
// Reload, never on its own: an open page may still ask for files that only the old version cached.

import { useSyncExternalStore } from 'react'

let apply: (() => void) | null = null
const subs = new Set<() => void>()

export function watchForUpdates(reg: ServiceWorkerRegistration) {
  let asked = false
  const offer = (sw: ServiceWorker) => {
    apply = () => {
      // Another tab may have switched to this version already; then no controllerchange will come here.
      if (sw.state === 'activating' || sw.state === 'activated') return location.reload()
      asked = true
      sw.postMessage({ type: 'SKIP_WAITING' })
    }
    subs.forEach((f) => f())
  }
  // With no controller this is the first install, not an update.
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing
    sw?.addEventListener('statechange', () => sw.state === 'installed' && navigator.serviceWorker.controller && offer(sw))
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => asked && location.reload())
  // An installed app can stay open for days; look for a new version each time it comes back into view.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}))
}

/** The action that switches to the waiting version, or null when there is none. */
export const useUpdate = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => apply,
  )
