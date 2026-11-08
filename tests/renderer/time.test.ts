/**
 * tests/renderer/time.test.ts   (message timestamps)
 *
 * Times are built from local clock values, so the tests give the same answer in every time zone.
 */
import { describe, expect, it } from 'vitest'
import { formatTime, timeStyleOf } from '../../src/renderer/src/lib/time'

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 7, h, m, s).getTime()
/** Newer ICU versions put a narrow no-break space before AM/PM; compare with a normal space. */
const plain = (s: string) => s.replace(/[  ]/g, ' ')

describe('timeStyleOf', () => {
  it('combines the mode and the seconds switch', () => {
    expect(timeStyleOf('off', true)).toBe('off')
    expect(timeStyleOf('12h', false)).toBe('12h')
    expect(timeStyleOf('12h', true)).toBe('12h-seconds')
    expect(timeStyleOf('24h', false)).toBe('24h')
    expect(timeStyleOf('24h', true)).toBe('24h-seconds')
  })
})

describe('formatTime', () => {
  it('shows nothing when off or for an invalid time', () => {
    expect(formatTime(at(9, 5), 'off')).toBe('')
    expect(formatTime(NaN, '24h')).toBe('')
    expect(formatTime(Infinity, '12h')).toBe('')
  })

  it('formats 24-hour time, with and without seconds', () => {
    expect(formatTime(at(9, 5, 7), '24h', 'en-US')).toBe('09:05')
    expect(formatTime(at(9, 5, 7), '24h-seconds', 'en-US')).toBe('09:05:07')
    expect(formatTime(at(18, 30), '24h', 'en-US')).toBe('18:30')
  })

  it('shows just after midnight as 00:05, never 24:05', () => {
    expect(formatTime(at(0, 5), '24h', 'en-US')).toBe('00:05')
  })

  it('formats 12-hour time with AM/PM', () => {
    expect(plain(formatTime(at(13, 7), '12h', 'en-US'))).toBe('1:07 PM')
    expect(plain(formatTime(at(0, 5), '12h', 'en-US'))).toBe('12:05 AM')
    expect(plain(formatTime(at(12, 0, 9), '12h-seconds', 'en-US'))).toBe('12:00:09 PM')
  })
})
