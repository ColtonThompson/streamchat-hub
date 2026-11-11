/**
 * tests/renderer/streaminfo.test.ts: when the title/viewers bar applies, and for which stream.
 */
import { describe, expect, it } from 'vitest'
import { formatViewers, streamInfoTarget } from '../../src/renderer/src/lib/streaminfo'
import type { Platform } from '../../src/shared/types'

const off = { twitch: false, youtube: false, kick: false, x: false, tiktok: false } as Record<Platform, boolean>
const text = { twitch: '', youtube: '', kick: '', x: '', tiktok: '' } as Record<Platform, string>
const on = (...p: Platform[]) => ({ ...off, ...Object.fromEntries(p.map((x) => [x, true])) }) as Record<Platform, boolean>

describe('streamInfoTarget', () => {
  it('one Twitch channel -> that channel', () => {
    expect(streamInfoTarget(true, on('twitch'), { ...text, twitch: 'Nightleaf' })).toEqual({ platform: 'twitch', source: 'nightleaf' })
  })
  it('one YouTube stream -> that stream (handle, id or link)', () => {
    expect(streamInfoTarget(true, on('youtube'), { ...text, youtube: '@MyChannel' })).toEqual({ platform: 'youtube', source: '@mychannel' })
    expect(streamInfoTarget(true, on('youtube'), { ...text, youtube: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({ platform: 'youtube', source: 'dQw4w9WgXcQ' })
  })
  it('the setting off -> nothing', () => {
    expect(streamInfoTarget(false, on('twitch'), { ...text, twitch: 'a' })).toBeNull()
  })
  it('several streams -> nothing (it would be ambiguous)', () => {
    expect(streamInfoTarget(true, on('twitch'), { ...text, twitch: 'a, b' })).toBeNull()
    expect(streamInfoTarget(true, on('twitch', 'youtube'), { ...text, twitch: 'a', youtube: '@b123' })).toBeNull()
    expect(streamInfoTarget(true, on('youtube'), { ...text, youtube: '@aaa @bbb' })).toBeNull()
  })
  it('another platform switched on counts as a second source', () => {
    expect(streamInfoTarget(true, on('twitch', 'kick'), { ...text, twitch: 'a' })).toBeNull()
  })
  it('a platform that is off does not count, even with channels typed', () => {
    expect(streamInfoTarget(true, on('twitch'), { ...text, twitch: 'a', youtube: '@bbb' })).toEqual({ platform: 'twitch', source: 'a' })
  })
  it('nothing on, or nothing typed -> nothing', () => {
    expect(streamInfoTarget(true, off, text)).toBeNull()
    expect(streamInfoTarget(true, on('twitch'), text)).toBeNull()
  })
})

describe('formatViewers', () => {
  it('adds thousands separators', () => {
    expect(formatViewers(1234567)).toBe('1,234,567')
    expect(formatViewers(0)).toBe('0')
  })
})
