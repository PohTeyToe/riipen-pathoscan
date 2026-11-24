import { useEffect, useState, type ReactNode } from 'react'

export function Bar({ field, step }: { field?: string; step?: string }) {
  return (
    <header className="bar">
      <a className="back" href="#/">
        ‹ Runs
      </a>
      {field && (
        <span className="where">
          <span className="field">{field}</span>
          {step}
        </span>
      )}
    </header>
  )
}

/** Longer than the gap between a double tap's two taps, even a slow one: the slowest double click a desktop allows is 900 ms. */
const ARM_MS = 1000

/**
 * False until a control that just came on screen may take a tap: once its screen has been painted and then in
 * view for ARM_MS. Every such screen opens on a tap and is drawn tens of milliseconds later, so the second tap of a
 * double tap never acts on a step the grower hasn't seen. Time with the page hidden doesn't count: back in view,
 * the wait starts again.
 */
export function useArmed() {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (armed) return
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      // The frame after next: the screen has been painted by then.
      frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => (timer = setTimeout(() => setArmed(true), ARM_MS)))))
    }
    wait()
    document.addEventListener('visibilitychange', wait)
    return () => {
      document.removeEventListener('visibilitychange', wait)
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [armed])
  return armed
}

/** A button, or with `href` a link, that takes no tap until it is armed (useArmed). It shows faded until then; the link has no target until then, so a middle click can't follow it either. */
export function Action({ onClick, href, ghost, children }: { onClick?: () => void; href?: string; ghost?: boolean; children: ReactNode }) {
  const armed = useArmed()
  const look = { className: ghost ? 'btn ghost' : 'btn', 'data-arming': armed ? undefined : '' }
  if (href)
    return (
      <a {...look} href={armed ? href : undefined} aria-disabled={!armed || undefined} onClick={armed ? onClick : undefined}>
        {children}
      </a>
    )
  return (
    <button type="button" {...look} disabled={!armed} onClick={onClick}>
      {children}
    </button>
  )
}
