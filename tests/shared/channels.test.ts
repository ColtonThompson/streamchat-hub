/**
 * tests/shared/channels.test.ts
 *
 * What gets accepted from the channel boxes. This runs in the UI AND again in the main process (IPC input
 * is untrusted), so the rules matter: only valid names may ever be joined.
 */
import { describe, expect, it } from 'vitest'
import { parseChannels, parseSources, parseYouTubeSources, youtubeSourceKind } from '../../src/shared/channels'

describe('parseChannels (Twitch)', () => {
  it('splits on commas and spaces and lower-cases', () => {
    expect(parseChannels('Streamer1, streamer2   STREAMER3')).toEqual(['streamer1', 'streamer2', 'streamer3'])
  })

  it('accepts #names and pasted twitch.tv links', () => {
    expect(parseChannels('#foo https://www.twitch.tv/bar twitch.tv/baz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('drops anything after the name in a link', () => {
    expect(parseChannels('https://twitch.tv/foo/videos, twitch.tv/bar?sr=a')).toEqual(['foo', 'bar'])
  })

  it('removes duplicates (ignoring case) and keeps first-seen order', () => {
    expect(parseChannels('b a B A b')).toEqual(['b', 'a'])
  })

  it('silently drops invalid entries', () => {
    expect(parseChannels('ok !!! has-dash bad.name ok2')).toEqual(['ok', 'ok2'])
  })

  it('allows 25 characters, rejects 26', () => {
    expect(parseChannels('a'.repeat(25))).toEqual(['a'.repeat(25)])
    expect(parseChannels('a'.repeat(26))).toEqual([])
  })

  it('keeps digits and underscores', () => {
    expect(parseChannels('pixel_witch_99')).toEqual(['pixel_witch_99'])
  })

  it('keeps at most 20 channels', () => {
    const many = Array.from({ length: 30 }, (_, i) => `chan${i}`).join(' ')
    expect(parseChannels(many)).toHaveLength(20)
    expect(parseChannels(many)[0]).toBe('chan0')
  })

  it('returns an empty list for empty or junk input', () => {
    expect(parseChannels('')).toEqual([])
    expect(parseChannels('  , ,, ')).toEqual([])
  })
})

describe('parseYouTubeSources', () => {
  const VID = 'dQw4w9WgXcQ'
  const CH = 'UC' + 'x'.repeat(22)

  it('accepts video ids, links of every shape, handles and channel ids', () => {
    expect(parseYouTubeSources(VID)).toEqual([VID])
    expect(parseYouTubeSources(`https://youtu.be/${VID}?t=3`)).toEqual([VID])
    expect(parseYouTubeSources(`https://www.youtube.com/watch?v=${VID}&t=30s`)).toEqual([VID])
    expect(parseYouTubeSources(`youtube.com/live/${VID}`)).toEqual([VID])
    expect(parseYouTubeSources('@MyChannel')).toEqual(['@mychannel'])
    expect(parseYouTubeSources('https://www.youtube.com/@MyChannel/live')).toEqual(['@mychannel'])
    expect(parseYouTubeSources(`https://www.youtube.com/channel/${CH}`)).toEqual([CH])
  })

  it('keeps video ids case-sensitive', () => {
    expect(parseYouTubeSources('DqW4w9wgxcq')).toEqual(['DqW4w9wgxcq'])
  })

  it('needs the @ on a handle (without it the text is not a handle)', () => {
    expect(parseYouTubeSources('mychannel')).toEqual([])
  })

  it('drops junk, removes duplicates, keeps at most 5', () => {
    expect(parseYouTubeSources(`nonsense ${VID} ${VID}`)).toEqual([VID])
    const six = Array.from({ length: 6 }, (_, i) => `@channel${i}`).join(' ')
    expect(parseYouTubeSources(six)).toHaveLength(5)
  })
})

describe('youtubeSourceKind', () => {
  it('tells the three kinds apart', () => {
    expect(youtubeSourceKind('dQw4w9WgXcQ')).toBe('video')
    expect(youtubeSourceKind('@someone')).toBe('handle')
    expect(youtubeSourceKind('UC' + 'y'.repeat(22))).toBe('channel')
    expect(youtubeSourceKind('nope')).toBeUndefined()
  })
})

describe('parseSources', () => {
  it('uses YouTube rules for youtube and Twitch rules for everything else', () => {
    expect(parseSources('youtube', '@abc')).toEqual(['@abc'])
    expect(parseSources('twitch', '@abc')).toEqual([]) // "@" is not valid in a Twitch name
    expect(parseSources('kick', 'Foo')).toEqual(['foo'])
  })
})
