// "Install to the home screen" before the first run: in a Safari tab, iOS deletes stored data after 7 days without a visit.

import { useSyncExternalStore } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void> }

let deferred: InstallPrompt | null = null
const subs = new Set<() => void>()
const changed = (e: InstallPrompt | null) => {
  deferred = e
  subs.forEach((f) => f())
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  changed(e as InstallPrompt)
})
addEventListener('appinstalled', () => changed(null))

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

/** What to offer: a button (Android, desktop Chrome), a line of how-to (iOS), or nothing (installed, or no way to install). */
export function useInstall(): { prompt: () => void } | 'ios' | null {
  const prompt = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => deferred,
  )
  if (standalone()) return null
  if (prompt) return { prompt: () => void prompt.prompt().finally(() => changed(null)) }
  return ios ? 'ios' : null
}
