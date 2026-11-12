// A step timer is only its start time, stored in the run, so a reload or a killed tab loses nothing.

/** Milliseconds left on a timer of `minutes` that started at `startedAt`. Never below 0, and never above the full time if the phone's clock moved back. */
export function remainingMs(startedAt: number, minutes: number, now: number): number {
  const total = minutes * 60_000
  return Math.min(total, Math.max(0, startedAt + total - now))
}

/** "19:05". Rounds up, so a running timer shows 0:00 only once it is done. */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
