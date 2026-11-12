import { describe, expect, it } from 'vitest'
import { clock, remainingMs, sessionClock } from './timer'

const MIN = 60_000

describe('step timer', () => {
  const start = 1_700_000_000_000

  it('has the full time at the start and counts down', () => {
    expect(remainingMs(start, 20, start)).toBe(20 * MIN)
    expect(remainingMs(start, 20, start + 5 * MIN)).toBe(15 * MIN)
  })

  it('works out the time left from the stored start alone, as after a reload', () => {
    expect(remainingMs(start, 30, start + 29 * MIN + 30_000)).toBe(30_000)
  })

  it('stops at zero', () => {
    expect(remainingMs(start, 5, start + 5 * MIN)).toBe(0)
    expect(remainingMs(start, 5, start + 60 * MIN)).toBe(0)
  })

  it('never shows more than the full time if the phone clock moved back', () => {
    expect(remainingMs(start, 5, start - 10 * MIN)).toBe(5 * MIN)
  })

  it('shows minutes and seconds, rounded up', () => {
    expect(clock(20 * MIN)).toBe('20:00')
    expect(clock(15 * MIN - 1)).toBe('15:00')
    expect(clock(61_000)).toBe('1:01')
    expect(clock(1)).toBe('0:01')
    expect(clock(0)).toBe('0:00')
  })
})

describe('the guide clock', () => {
  const fake = () => {
    const t = { wall: 1_700_000_000_000, mono: 500 }
    return { t, c: sessionClock(() => t.wall, () => t.mono) }
  }

  it('ignores a change to the phone clock while the guide is open', () => {
    const { t, c } = fake()
    const start = c.now()
    t.mono += 60_000
    t.wall += 60 * MIN // the clock is moved an hour forward
    expect(remainingMs(start, 20, c.now())).toBe(19 * MIN)
    t.wall -= 3 * 60 * MIN // and then back
    expect(remainingMs(start, 20, c.now())).toBe(19 * MIN)
  })

  it('takes the wall clock again on resync, for time the phone slept through', () => {
    const { t, c } = fake()
    const start = c.now()
    t.wall += 10 * MIN // asleep: the wall clock moved, the monotonic clock didn't
    expect(remainingMs(start, 20, c.now())).toBe(20 * MIN)
    c.resync()
    expect(remainingMs(start, 20, c.now())).toBe(10 * MIN)
  })
})
