/** tests/shared/duration.test.ts: timeout length helpers shared by the settings box, panel and bus. */
import { describe, expect, it } from 'vitest'
import { clampTimeout, formatDuration, splitDuration, toSeconds, TIMEOUT_DEFAULT, TIMEOUT_MAX } from '../../src/shared/duration'

describe('duration', () => {
  it('clamps to Twitch limits and defaults bad input', () => {
    expect(clampTimeout(0)).toBe(1)
    expect(clampTimeout(1e9)).toBe(TIMEOUT_MAX)
    expect(clampTimeout('5')).toBe(TIMEOUT_DEFAULT)
    expect(clampTimeout(NaN)).toBe(TIMEOUT_DEFAULT)
    expect(clampTimeout(90.4)).toBe(90)
  })
  it('formats with up to two units', () => {
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(5400)).toBe('1h 30m')
  })
  it('splits into the largest even unit and back', () => {
    expect(splitDuration(600)).toEqual({ amount: 10, unit: 'm' })
    expect(splitDuration(90)).toEqual({ amount: 90, unit: 's' })
    expect(splitDuration(172800)).toEqual({ amount: 2, unit: 'd' })
    expect(toSeconds(10, 'm')).toBe(600)
    expect(toSeconds(100, 'd')).toBe(TIMEOUT_MAX)
  })
})
