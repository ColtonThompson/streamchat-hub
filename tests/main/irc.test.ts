/**
 * tests/main/irc.test.ts   (the raw Twitch chat line splitter)
 */
import { describe, expect, it } from 'vitest'
import { parseIrc } from '../../src/main/adapters/twitch/irc'

describe('parseIrc', () => {
  it('splits tags, prefix, command, channel and text', () => {
    const m = parseIrc('@color=#FF0000;display-name=Pixel;mod=1 :pixel!pixel@pixel.tmi.twitch.tv PRIVMSG #chan :hello there')!
    expect(m.tags).toEqual({ color: '#FF0000', 'display-name': 'Pixel', mod: '1' })
    expect(m.prefix).toBe('pixel!pixel@pixel.tmi.twitch.tv')
    expect(m.command).toBe('PRIVMSG')
    expect(m.params).toEqual(['#chan'])
    expect(m.trailing).toBe('hello there')
  })

  it('un-escapes tag values', () => {
    const m = parseIrc('@system-msg=A\\sB\\:C\\\\D\\nE :tmi.twitch.tv USERNOTICE #c')!
    expect(m.tags['system-msg']).toBe('A B;C\\D\nE')
  })

  it('maps a tag without a value to an empty string', () => {
    expect(parseIrc('@flag;other=1 :x PING')!.tags).toEqual({ flag: '', other: '1' })
  })

  it('keeps colons and spaces inside the trailing text', () => {
    const m = parseIrc(':n!n@n PRIVMSG #c :look: a : b')!
    expect(m.trailing).toBe('look: a : b')
  })

  it('handles lines with no tags or prefix', () => {
    const m = parseIrc('PING :tmi.twitch.tv')!
    expect(m.command).toBe('PING')
    expect(m.trailing).toBe('tmi.twitch.tv')
    expect(m.tags).toEqual({})
    expect(m.prefix).toBeUndefined()
  })

  it('handles numeric commands with several params', () => {
    const m = parseIrc(':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!')!
    expect(m.command).toBe('001')
    expect(m.params).toEqual(['justinfan123'])
    expect(m.trailing).toBe('Welcome, GLHF!')
  })

  it('has no trailing text when there is none', () => {
    expect(parseIrc(':tmi.twitch.tv JOIN #chan')!.trailing).toBeUndefined()
  })

  it('returns null for malformed lines instead of throwing', () => {
    expect(parseIrc('')).toBeNull()
    expect(parseIrc('@onlytags')).toBeNull()
    expect(parseIrc(':onlyprefix')).toBeNull()
    expect(parseIrc('   ')).toBeNull()
  })
})
