/**
 * tests/main/twitch-parse.test.ts
 *
 * Turning raw Twitch chat lines into what the UI shows: messages (emotes, links, badges, /me, cheers),
 * channel events (subs, raids, announcements) and moderation (deletes, timeouts, bans).
 */
import { describe, expect, it } from 'vitest'
import type { ModerationEvent } from '../../src/shared/types'
import { parseIrc } from '../../src/main/adapters/twitch/irc'
import { clearmsgToAction, parseClearChat, privmsgToChatMessage, usernoticeToChatMessage } from '../../src/main/adapters/twitch/parse'

const irc = (line: string) => parseIrc(line)!
const chat = (tags: string, text: string, channel = 'chan', nick = 'pixel') =>
  privmsgToChatMessage(irc(`@${tags} :${nick}!${nick}@${nick}.tmi.twitch.tv PRIVMSG #${channel} :${text}`))!

describe('privmsgToChatMessage', () => {
  it('builds author, badges, flags and timestamp from the tags', () => {
    const m = chat(
      'badges=moderator/1,subscriber/12;color=#FF4500;display-name=PixelWitch;id=abc;mod=1;subscriber=1;tmi-sent-ts=1700000000000;user-id=42',
      'hello'
    )
    expect(m.id).toBe('abc')
    expect(m.platform).toBe('twitch')
    expect(m.channelId).toBe('chan')
    expect(m.author).toMatchObject({ id: '42', name: 'PixelWitch', color: '#FF4500' })
    expect(m.author.badges.map((b) => b.label)).toEqual(['MOD', 'SUB'])
    expect(m.timestamp).toBe(1700000000000)
    expect(m.meta).toMatchObject({ isMod: true, isSub: true })
  })

  it('treats a moderator badge as moderator even without mod=1', () => {
    expect(chat('badges=moderator/1', 'x').meta?.isMod).toBe(true)
    expect(chat('badges=', 'x').meta?.isMod).toBe(false)
  })

  it('splits emotes, text and links in order', () => {
    const m = chat('emotes=25:0-4', 'Kappa hello https://x.io/a?b=1 bye')
    expect(m.parts).toEqual([
      { type: 'emote', value: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', source: 'native' },
      { type: 'text', value: ' hello ' },
      { type: 'link', value: 'https://x.io/a?b=1', url: 'https://x.io/a?b=1' },
      { type: 'text', value: ' bye' }
    ])
  })

  it('accepts v2 emote ids but ignores ids that could change the image address', () => {
    const ok = chat('emotes=emotesv2_9ab12:0-4', 'Kappa').parts[0] as { type: string; url: string }
    expect(ok.type).toBe('emote')
    expect(ok.url).toContain('/emotesv2_9ab12/')
    expect(chat('emotes=ev%il?x\\y:0-4', 'Kappa').parts.every((p) => p.type !== 'emote')).toBe(true)
  })

  it('orders emotes left to right even though Twitch groups them by emote', () => {
    const m = chat('emotes=25:6-10/1902:0-4', 'Keepo Kappa') // Kappa (25) is listed first but sits second
    expect(m.parts.filter((p) => p.type === 'emote').map((p) => p.value)).toEqual(['Keepo', 'Kappa'])
  })

  it('counts emote positions in characters, not UTF-16 units (emoji before an emote)', () => {
    const m = chat('emotes=25:2-6', '😀 Kappa')
    expect(m.parts.map((p) => p.value)).toEqual(['😀 ', 'Kappa'])
  })

  it('ignores emote data that is out of range, overlapping or malformed', () => {
    expect(chat('emotes=25:0-99', 'short').parts).toEqual([{ type: 'text', value: 'short' }])
    expect(chat('emotes=25:0-4,25:2-6', 'Kappa Kappa').parts.filter((p) => p.type === 'emote')).toHaveLength(1)
    expect(chat('emotes=garbage', 'plain').parts).toEqual([{ type: 'text', value: 'plain' }])
  })

  it('unwraps /me actions', () => {
    const m = chat('id=a', '\x01ACTION waves\x01')
    expect(m.meta?.isAction).toBe(true)
    expect(m.parts).toEqual([{ type: 'text', value: 'waves' }])
    expect(chat('id=b', 'plain').meta?.isAction).toBeUndefined()
  })

  it('records cheers only when bits were sent', () => {
    expect(chat('bits=100', 'cheer100').meta?.bits).toBe(100)
    expect(chat('bits=0', 'x').meta?.bits).toBeUndefined()
    expect(chat('id=a', 'x').meta?.bits).toBeUndefined()
  })

  it('falls back to the nick, a stable colour and a generated id', () => {
    const a = chat('user-id=1', 'x', 'chan', 'nameless')
    const b = chat('user-id=1', 'y', 'chan', 'nameless')
    expect(a.author.name).toBe('nameless')
    expect(a.author.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(a.author.color).toBe(b.author.color) // same name, same colour
    expect(a.id).toMatch(/^msg-chan-/)
    expect(a.id).not.toBe(b.id)
  })

  it('returns null when there is no channel or no text', () => {
    expect(privmsgToChatMessage(irc(':a!a@a PRIVMSG'))).toBeNull()
    expect(privmsgToChatMessage(irc(':a!a@a PRIVMSG #chan'))).toBeNull()
  })
})

describe('usernoticeToChatMessage', () => {
  const notice = (tags: string, trailing = '', channel = 'chan') =>
    usernoticeToChatMessage(irc(`@${tags} :tmi.twitch.tv USERNOTICE #${channel}${trailing ? ' :' + trailing : ''}`))

  it('shows the system message as the event title and names the user from the login tag', () => {
    const m = notice('msg-id=sub;login=pixelwitch;display-name=PixelWitch;system-msg=PixelWitch\\ssubscribed\\sat\\sTier\\s1.;id=n1')!
    expect(m.event).toMatchObject({ type: 'sub', title: 'PixelWitch subscribed at Tier 1.' })
    expect(m.author.name).toBe('PixelWitch')
    expect(m.id).toBe('n1')
  })

  it('keeps the viewer message on a resub', () => {
    const m = notice('msg-id=resub;login=a;system-msg=a\\sresubscribed', 'still here!')!
    expect(m.event?.type).toBe('resub')
    expect(m.parts).toEqual([{ type: 'text', value: 'still here!' }])
  })

  it('maps event kinds', () => {
    const type = (id: string) => notice(`msg-id=${id};login=a;system-msg=x`)!.event!.type
    expect(type('subgift')).toBe('subgift')
    expect(type('submysterygift')).toBe('giftbomb')
    expect(type('raid')).toBe('raid')
    expect(type('viewermilestone')).toBe('milestone')
    expect(type('somethingnew')).toBe('notice') // unknown kinds still show
  })

  it('shows an announcement as its message, with its colour and no title', () => {
    const m = notice('msg-id=announcement;msg-param-color=PRIMARY;login=mod1', 'Giveaway at 8!')!
    expect(m.event).toMatchObject({ type: 'announcement', title: '', color: '#9b6bff' })
    expect(m.parts).toEqual([{ type: 'text', value: 'Giveaway at 8!' }])
  })

  it('returns null when there is nothing to show', () => {
    expect(notice('msg-id=sub;login=a')).toBeNull()
    expect(usernoticeToChatMessage(irc('@msg-id=sub;system-msg=x :tmi.twitch.tv USERNOTICE'))).toBeNull()
  })
})

describe('clearmsgToAction', () => {
  it('turns a deleted message into a delete action', () => {
    const a = clearmsgToAction(irc('@login=bob;target-msg-id=MSG1 :tmi.twitch.tv CLEARMSG #Chan :oops'))
    expect(a).toEqual({ type: 'delete-message', platform: 'twitch', channelId: 'Chan', messageId: 'MSG1' })
  })

  it('returns null without a target id', () => {
    expect(clearmsgToAction(irc(':tmi.twitch.tv CLEARMSG #chan :x'))).toBeNull()
  })
})

describe('parseClearChat', () => {
  /** The "a user was removed" action (the other kind, a deleted message, has no duration). */
  const durationOf = (a?: ModerationEvent) => (a as Extract<ModerationEvent, { type: 'clear-user' }> | undefined)?.durationSec
  const clear = (tags: string, user?: string) => parseClearChat(irc(`@${tags} :tmi.twitch.tv CLEARCHAT #chan${user ? ' :' + user : ''}`))!

  it('reports a ban with an undo target', () => {
    const r = clear('target-user-id=7;tmi-sent-ts=1700000000000', 'BadGuy')
    expect(r.action).toEqual({ type: 'clear-user', platform: 'twitch', channelId: 'chan', userId: '7', login: 'badguy', durationSec: undefined })
    expect(r.notice.event).toMatchObject({ type: 'moderation', title: 'BadGuy was banned', target: { userId: '7', login: 'BadGuy' } })
    expect(r.notice.author.name).toBe('') // a system row has no author
  })

  it('reports a timeout with a readable duration', () => {
    const title = (secs: number) => clear(`ban-duration=${secs};target-user-id=7`, 'x').notice.event!.title
    expect(title(30)).toBe('x was timed out for 30s')
    expect(title(90)).toBe('x was timed out for 1m 30s')
    expect(title(3600)).toBe('x was timed out for 1h')
    expect(title(90061)).toBe('x was timed out for 1d 1h') // at most two units
    expect(title(1209600)).toBe('x was timed out for 2w')
  })

  it('keeps the duration on the action', () => {
    expect(durationOf(clear('ban-duration=600;target-user-id=7', 'x').action)).toBe(600)
  })

  it('treats a zero duration as a ban', () => {
    const r = clear('ban-duration=0', 'x')
    expect(durationOf(r.action)).toBeUndefined()
    expect(r.notice.event?.title).toBe('x was banned')
  })

  it('reports a full chat clear without any per-user action', () => {
    const r = clear('tmi-sent-ts=1700000000000')
    expect(r.action).toBeUndefined()
    expect(r.notice.event?.title).toBe('Chat was cleared by a moderator')
  })

  it('returns null without a channel', () => {
    expect(parseClearChat(irc(':tmi.twitch.tv CLEARCHAT'))).toBeNull()
  })
})
