import { describe, expect, it } from 'vitest'
import { yourCalls } from './Result'

describe('the line on calls that decided a result', () => {
  it('agrees with one call and with many', () => {
    expect(yourCalls(1, 3)).toBe('1 of the 3 positives is your call.')
    expect(yourCalls(2, 3)).toBe('2 of the 3 positives are your calls.')
  })
})
