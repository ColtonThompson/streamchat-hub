/**
 * tests/main/gifts.test.ts
 *
 * "X gifted 20 subs" arrives as one summary plus 20 single-gift notices. The filter lets the UI show only the summary.
 */
import { describe, expect, it } from 'vitest'
import { GiftBombFilter } from '../../src/main/adapters/twitch/gifts'

describe('GiftBombFilter', () => {
  it('recognises single gifts that belong to a noted bomb', () => {
    const f = new GiftBombFilter()
    f.note('origin-1', 1000)
    expect(f.isPartOfBomb('origin-1', 1500)).toBe(true)
  })

  it('does not hide gifts from other (or no) origins', () => {
    const f = new GiftBombFilter()
    f.note('origin-1', 1000)
    expect(f.isPartOfBomb('origin-2', 1000)).toBe(false)
    expect(f.isPartOfBomb(undefined, 1000)).toBe(false)
    expect(f.isPartOfBomb('', 1000)).toBe(false)
  })

  it('forgets a bomb after 10 minutes', () => {
    const f = new GiftBombFilter()
    f.note('o', 0)
    expect(f.isPartOfBomb('o', 10 * 60_000)).toBe(true)
    expect(f.isPartOfBomb('o', 10 * 60_000 + 1)).toBe(false)
  })

  it('can note the same bomb again later (a new window starts)', () => {
    const f = new GiftBombFilter()
    f.note('o', 0)
    f.note('o', 9 * 60_000)
    expect(f.isPartOfBomb('o', 15 * 60_000)).toBe(true)
  })
})
