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

/** A button that takes no taps for its first half second, so a double tap can't also finish the next step. */
export function Action({ onClick, ghost, children }: { onClick: () => void; ghost?: boolean; children: ReactNode }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 500)
    return () => clearTimeout(t)
  }, [])
  return (
    <button type="button" className={ghost ? 'btn ghost' : 'btn'} data-arming={armed ? undefined : ''} disabled={!armed} onClick={onClick}>
      {children}
    </button>
  )
}
