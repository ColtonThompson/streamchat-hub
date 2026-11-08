/**
 * tests/renderer/rows.test.ts   (which messages are listed, and the alternating row shades)
 */
import { describe, expect, it } from 'vitest'
import { buildRows, newShading, type FeedFilters } from '../../src/renderer/src/lib/rows'
import { chatMessage } from '../helpers/factories'

const all = { twitch: true, youtube: true, kick: true, x: true, tiktok: true }
/** The app's settings store keeps the SAME blacklist array until the list changes, and rows.ts relies on that. */
const NO_TERMS: string[] = []
const filters = (over: Partial<FeedFilters> = {}): FeedFilters => ({ enabled: all, showEvents: true, blacklist: NO_TERMS, isBlacklisted: () => false, ...over })
const memory = (blacklist: string[] = NO_TERMS) => ({ current: newShading(blacklist) })

describe('buildRows: what is shown', () => {
  it('lists messages in order', () => {
    const msgs = [chatMessage({ id: 'a' }), chatMessage({ id: 'b' })]
    expect(buildRows(msgs, filters(), memory()).map((r) => r.msg.id)).toEqual(['a', 'b'])
  })

  it('hides platforms that are switched off', () => {
    const msgs = [chatMessage({ id: 'a', platform: 'twitch' }), chatMessage({ id: 'b', platform: 'youtube' })]
    const rows = buildRows(msgs, filters({ enabled: { ...all, youtube: false } }), memory())
    expect(rows.map((r) => r.msg.id)).toEqual(['a'])
  })

  it('hides events when "show events" is off', () => {
    const msgs = [chatMessage({ id: 'a' }), chatMessage({ id: 'b', event: { type: 'raid', title: 'raid' } })]
    expect(buildRows(msgs, filters({ showEvents: false }), memory()).map((r) => r.msg.id)).toEqual(['a'])
  })

  it('hides blacklisted messages', () => {
    const msgs = [chatMessage({ id: 'a', text: 'spam' }), chatMessage({ id: 'b', text: 'ok' })]
    const rows = buildRows(msgs, filters({ isBlacklisted: (m) => m.id === 'a' }), memory())
    expect(rows.map((r) => r.msg.id)).toEqual(['b'])
  })
})

describe('buildRows: row shades', () => {
  const four = () => ['a', 'b', 'c', 'd'].map((id) => chatMessage({ id }))

  it('alternates between the two shades', () => {
    expect(buildRows(four(), filters(), memory()).map((r) => r.alt)).toEqual([0, 1, 0, 1])
  })

  it('keeps each message\'s shade when older messages are trimmed away (no flicker)', () => {
    const mem = memory()
    const msgs = four()
    const before = buildRows(msgs, filters(), mem)
    const after = buildRows(msgs.slice(1), filters(), mem) // "a" scrolled out of the buffer
    expect(after.map((r) => r.alt)).toEqual(before.slice(1).map((r) => r.alt))
  })

  it('gives a newly arrived message the opposite shade of the one before it', () => {
    const mem = memory()
    const msgs = four()
    buildRows(msgs, filters(), mem)
    const next = buildRows([...msgs, chatMessage({ id: 'e' })], filters(), mem)
    expect(next.at(-1)?.alt).toBe(0) // "d" was 1
  })

  it('starts over when the visible platforms change', () => {
    const mem = memory()
    const msgs = four()
    buildRows(msgs, filters(), mem)
    const rows = buildRows(msgs.slice(1), filters({ showEvents: false }), mem)
    expect(rows.map((r) => r.alt)).toEqual([0, 1, 0])
  })

  it('starts over when the blacklist changes (compared by reference)', () => {
    const mem = memory()
    const msgs = four()
    buildRows(msgs, filters(), mem)
    const rows = buildRows(msgs.slice(1), filters({ blacklist: ['new term'] /* a NEW array */ }), mem)
    expect(rows.map((r) => r.alt)).toEqual([0, 1, 0])
  })

  it('forgets shades of messages that are long gone', () => {
    const mem = memory()
    const old = Array.from({ length: 600 }, (_, i) => chatMessage({ id: `old${i}` }))
    buildRows(old, filters(), mem)
    expect(mem.current.map.size).toBe(600)
    buildRows([chatMessage({ id: 'fresh' })], filters(), mem)
    expect(mem.current.map.size).toBe(1)
  })
})
