/**
 * tests/renderer/streaminfo.test.ts: when the title/viewers bar applies, and for which stream.
 */
import { describe, expect, it } from 'vitest'
import { allChannels, channelKey, formatViewers, primaryChannel, streamInfoTarget } from '../../src/renderer/src/lib/streaminfo'
import type { Platform } from '../../src/shared/types'

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
