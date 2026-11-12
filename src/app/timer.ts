// A step timer is only its start time, stored in the run, so a reload or a killed tab loses nothing.

/** Milliseconds left on a timer of `minutes` that started at `startedAt`. Elapsed time is clamped to >= 0, so a clock that moved back shows the full time, never more. */
export function remainingMs(startedAt: number, minutes: number, now: number): number {
  const elapsed = Math.max(0, now - startedAt)
  return Math.max(0, minutes * 60_000 - elapsed)
}

/** "19:05". Rounds up, so a running timer shows 0:00 only once it is done. */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The time the guide counts against. It reads the wall clock once and then advances with
 * performance.now(), so changing the phone's clock while the guide is open doesn't move a timer.
 * performance.now() can stop while a phone sleeps, so `resync` takes the wall clock again when the
 * page comes back into view. Across a reload or a return from the background only the wall clock
 * exists, and remainingMs clamps for a clock that moved back.
 */
export function sessionClock(wall = () => Date.now(), mono = () => performance.now()) {
  let base = wall()
  let at = mono()
  return {
    now: () => base + (mono() - at),
    resync() {
      base = wall()
      at = mono()
    },
  }
}

export type SessionClock = ReturnType<typeof sessionClock>
