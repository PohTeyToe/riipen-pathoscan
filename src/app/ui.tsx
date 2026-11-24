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

/** About the quickest anyone reacts to something new on screen: a tap sooner can't be an answer to it. */
const SHOWN_MS = 300
/** Taps closer than this are one double tap, even a slow one. The slowest double click a desktop allows is 900 ms. */
const DOUBLE_TAP_MS = 1000
let lastTap = -Infinity
let listening = false

/**
 * False until a control that just came on screen may take a tap, so the second tap of a double tap never acts
 * on a screen the first one opened. That is once the screen has been painted and shown for SHOWN_MS, and
 * DOUBLE_TAP_MS have passed since the last tap anywhere on the page. A tap on a control that isn't ready yet
 * is dropped and doesn't count as a tap.
 */
export function useArmed() {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!listening) addEventListener('click', (e) => (e.target as Element).closest('[data-arming]') || (lastTap = performance.now()), true)
    listening = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // The frame after next: this screen has been painted by then.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timer = setTimeout(() => setArmed(true), Math.max(SHOWN_MS, lastTap + DOUBLE_TAP_MS - performance.now()))
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])
  return armed
}

/** A button, or with `href` a link, that takes no tap until it is armed (useArmed). It shows faded until then. */
export function Action({ onClick, href, ghost, children }: { onClick?: () => void; href?: string; ghost?: boolean; children: ReactNode }) {
  const armed = useArmed()
  const look = { className: ghost ? 'btn ghost' : 'btn', 'data-arming': armed ? undefined : '' }
  if (href)
    return (
      <a {...look} href={href} aria-disabled={!armed || undefined} onClick={(e) => (armed ? onClick?.() : e.preventDefault())}>
        {children}
      </a>
    )
  return (
    <button type="button" {...look} disabled={!armed} onClick={onClick}>
      {children}
    </button>
  )
}
