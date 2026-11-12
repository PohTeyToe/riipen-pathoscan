import { describe, expect, it } from 'vitest'
import { clock, remainingMs } from './timer'

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
