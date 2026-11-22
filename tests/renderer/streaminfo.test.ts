/**
 * tests/renderer/streaminfo.test.ts: when the title/viewers bar applies, and for which stream.
 */
import { describe, expect, it } from 'vitest'
import { allChannels, channelKey, formatViewers, infoFor, primaryChannel, streamChanges, streamInfoTarget, watchTargets } from '../../src/renderer/src/lib/streaminfo'
import type { Platform, StreamInfo } from '../../src/shared/types'

const text = { twitch: '', youtube: '', kick: '', x: '', tiktok: '' } as Record<Platform, string>
const ch = (over: Partial<Record<Platform, string>>) => ({ ...text, ...over })

describe('allChannels', () => {
  it('lists Twitch first, then YouTube, each platform in the order added, cleaned', () => {
    expect(allChannels(ch({ twitch: 'B, twitch.tv/a', youtube: '@Yy1 https://youtu.be/dQw4w9WgXcQ' }))).toEqual([
      { platform: 'twitch', source: 'b' },
      { platform: 'twitch', source: 'a' },
      { platform: 'youtube', source: '@yy1' },
      { platform: 'youtube', source: 'dQw4w9WgXcQ' }
    ])
  })
  it('is empty with nothing typed or only junk', () => {
    expect(allChannels(text)).toEqual([])
    expect(allChannels(ch({ twitch: '!!!' }))).toEqual([])
  })
  it('channelKey is platform:source', () => {
    expect(channelKey({ platform: 'youtube', source: '@abc' })).toBe('youtube:@abc')
  })
})

describe('primaryChannel / streamInfoTarget', () => {
  it('one channel -> that channel (Twitch, or YouTube handle / id / link)', () => {
    expect(streamInfoTarget(true, ch({ twitch: 'Nightleaf' }), '')).toEqual({ platform: 'twitch', source: 'nightleaf' })
    expect(streamInfoTarget(true, ch({ youtube: '@MyChannel' }), '')).toEqual({ platform: 'youtube', source: '@mychannel' })
    expect(streamInfoTarget(true, ch({ youtube: 'https://youtu.be/dQw4w9WgXcQ' }), '')).toEqual({ platform: 'youtube', source: 'dQw4w9WgXcQ' })
  })
  it('several channels: still one stream, the chosen one', () => {
    const c = ch({ twitch: 'a, b', youtube: '@bbb' })
    expect(streamInfoTarget(true, c, 'twitch:b')).toEqual({ platform: 'twitch', source: 'b' })
    expect(streamInfoTarget(true, c, 'youtube:@bbb')).toEqual({ platform: 'youtube', source: '@bbb' })
  })
  it('no choice, or a choice that was removed -> the first channel', () => {
    const c = ch({ twitch: 'a, b' })
    expect(streamInfoTarget(true, c, '')).toEqual({ platform: 'twitch', source: 'a' })
    expect(streamInfoTarget(true, c, 'twitch:gone')).toEqual({ platform: 'twitch', source: 'a' })
  })
  it('the setting off, or no channels -> nothing', () => {
    expect(streamInfoTarget(false, ch({ twitch: 'a' }), '')).toBeNull()
    expect(streamInfoTarget(true, text, '')).toBeNull()
    expect(primaryChannel(text, 'twitch:a')).toBeNull()
  })
})

describe('formatViewers', () => {
  it('adds thousands separators', () => {
    expect(formatViewers(1234567)).toBe('1,234,567')
    expect(formatViewers(0)).toBe('0')
  })
})

describe('watchTargets / infoFor', () => {
  it('every channel is watched, not only the one in the bar', () => {
    expect(watchTargets(ch({ twitch: 'a, b', youtube: '@yyy' })).map(channelKey)).toEqual(['twitch:a', 'twitch:b', 'youtube:@yyy'])
    expect(watchTargets(text)).toEqual([])
  })
  it('finds the info of one channel', () => {
    const i: StreamInfo = { platform: 'twitch', source: 'a', live: true }
    expect(infoFor([i], { platform: 'twitch', source: 'a' })).toBe(i)
    expect(infoFor([i], { platform: 'youtube', source: 'a' })).toBeUndefined()
  })
})

describe('streamChanges', () => {
  const s = (over: Partial<StreamInfo>): StreamInfo => ({ platform: 'twitch', source: 'a', live: false, ...over })
  it('offline -> live is "live", live -> offline is "offline"', () => {
    expect(streamChanges([s({})], [s({ live: true, title: 'Hi' })]).map((c) => c.kind)).toEqual(['live'])
    expect(streamChanges([s({ live: true, title: 'Hi' })], [s({})]).map((c) => c.kind)).toEqual(['offline'])
  })
  it('a new title while live is "title"; the same title or viewers moving is nothing', () => {
    expect(streamChanges([s({ live: true, title: 'A' })], [s({ live: true, title: 'B' })]).map((c) => c.kind)).toEqual(['title'])
    expect(streamChanges([s({ live: true, title: 'A', viewers: 1 })], [s({ live: true, title: 'A', viewers: 9 })])).toEqual([])
  })
  it('the first sighting is only a baseline', () => {
    expect(streamChanges([], [s({ live: true, title: 'A' })])).toEqual([])
  })
  it('stale or unreadable answers never count', () => {
    expect(streamChanges([s({ live: true, title: 'A' })], [s({ live: false, stale: true, note: 'Not updating: x' })])).toEqual([])
    expect(streamChanges([s({ live: false, note: 'Sign in' })], [s({ live: true, title: 'A' })])).toEqual([])
  })
})
