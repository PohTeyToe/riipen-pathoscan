import { useEffect } from 'react'

/** Calls `fn` whenever the page comes back into view: another tab may have changed a run meanwhile. */
export function useOnVisible(fn: () => void) {
  useEffect(() => {
    const onChange = () => document.visibilityState === 'visible' && fn()
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [fn])
}
