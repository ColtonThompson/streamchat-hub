/**
 * tests/renderer/channelbreaks.test.ts   (the "joined / left" dividers)
 */
import { describe, expect, it } from 'vitest'
import { channelBreaks, isBreak, makeBreak, sourceLabel } from '../../src/renderer/src/lib/channelbreaks'

describe('sourceLabel', () => {
  it('writes each kind of source the way people read it', () => {
    expect(sourceLabel('twitch', 'nightleaf')).toBe('#nightleaf')
    expect(sourceLabel('youtube', '@nightleaf')).toBe('@nightleaf')
    expect(sourceLabel('youtube', 'dQw4w9WgXcQ')).toBe('stream dQw4w9WgXcQ')
    expect(sourceLabel('youtube', 'UC' + 'a'.repeat(22))).toBe('UC' + 'a'.repeat(22))
  })
})

describe('makeBreak', () => {
  it('is an event row with readable text, and a fresh id each time', () => {
    const a = makeBreak('twitch', 'nightleaf', 'joined', 1000)
    const b = makeBreak('twitch', 'nightleaf', 'joined', 1000)
    expect(a.event).toEqual({ type: 'break', title: 'Joined #nightleaf' })
    expect(makeBreak('twitch', 'nightleaf', 'left').event?.title).toBe('Left #nightleaf')
    expect(a.platform).toBe('twitch')
    expect(a.channelId).toBe('nightleaf')
    expect(a.timestamp).toBe(1000)
    expect(a.id).not.toBe(b.id)
    expect(isBreak(a)).toBe(true)
  })
})

describe('channelBreaks', () => {
  const titles = (list: ReturnType<typeof channelBreaks>) => list.map((m) => m.event?.title)

  it('one divider per channel that joined or left, "left" first', () => {
    expect(titles(channelBreaks('twitch', ['a', 'b'], ['b', 'c', 'd']))).toEqual(['Left #a', 'Joined #c', 'Joined #d'])
  })

  it('nothing when the list did not change (or only its order did)', () => {
    expect(channelBreaks('twitch', ['a', 'b'], ['a', 'b'])).toEqual([])
    expect(channelBreaks('twitch', ['a', 'b'], ['b', 'a'])).toEqual([])
  })

  it('works from and to an empty list', () => {
    expect(titles(channelBreaks('twitch', [], ['a']))).toEqual(['Joined #a'])
    expect(titles(channelBreaks('twitch', ['a'], []))).toEqual(['Left #a'])
  })
})
