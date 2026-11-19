/**
 * tests/renderer/chatters.test.ts   (who has chatted, and the sections of the chatters list)
 */
import { describe, expect, it } from 'vitest'
import { chatterKey, chatterUpdate, groupChatters, roleDetail, roleOf, topRole, type Chatter } from '../../src/renderer/src/lib/chatters'
import type { Badge, ChatMessage } from '../../src/shared/types'
import { chatMessage } from '../helpers/factories'

const badge = (id: string): Badge => ({ id, label: '' })
const from = (name: string, badges: string[] = [], over: Partial<ChatMessage> = {}) =>
  chatMessage({ name, author: { id: `id-${name}`, name, badges: badges.map(badge) }, ...over })

describe('roleOf', () => {
  it('reads Twitch badges', () => {
    expect(roleOf(from('a', ['broadcaster/1']))).toBe('broadcaster')
    expect(roleOf(from('a', ['moderator/1', 'subscriber/12']))).toBe('moderator')
    expect(roleOf(from('a', ['lead_moderator/1']))).toBe('moderator')
    expect(roleOf(from('a', ['vip/1']))).toBe('vip')
    expect(roleOf(from('a', ['subscriber/6', 'premium/1']))).toBe('viewer')
    expect(roleOf(from('a'))).toBe('viewer')
  })
  it('reads YouTube badges: owner is the broadcaster', () => {
    expect(roleOf(from('a', ['owner'], { platform: 'youtube' }))).toBe('broadcaster')
    expect(roleOf(from('a', ['moderator'], { platform: 'youtube' }))).toBe('moderator')
    expect(roleOf(from('a', ['member'], { platform: 'youtube' }))).toBe('viewer')
  })
  it('on Twitch, chatting in your own channel makes you the broadcaster even without the badge', () => {
    expect(roleOf(from('NightLeaf', [], { channelId: 'nightleaf' }))).toBe('broadcaster')
    expect(roleOf(from('NightLeaf', [], { channelId: 'other' }))).toBe('viewer')
  })
  it('the highest role wins when badges overlap', () => {
    expect(roleOf(from('a', ['vip/1', 'moderator/1']))).toBe('moderator')
    expect(roleOf(from('a', ['moderator/1', 'broadcaster/1']))).toBe('broadcaster')
  })
})

describe('chatterUpdate', () => {
  it('creates an entry from a chat line, with the role in that channel', () => {
    const c = chatterUpdate(undefined, from('Bob', ['moderator/1'], { channelId: 'chan' }))!
    expect(c).toEqual({ platform: 'twitch', name: 'Bob', id: 'id-Bob', roles: { '#chan': 'moderator' }, last: 'chan' })
  })
  it('returns undefined when nothing changed (same name, same role there)', () => {
    const msg = from('Bob')
    const c = chatterUpdate(undefined, msg)!
    expect(chatterUpdate(c, from('Bob'))).toBeUndefined()
  })
  it('remembers the channel of the latest message, and counts a switch of channel as a change', () => {
    let c = chatterUpdate(undefined, from('Bob', [], { channelId: 'a' }))!
    expect(c.last).toBe('a')
    c = chatterUpdate(c, from('Bob', [], { channelId: 'b' }))!
    expect(c.last).toBe('b')
    expect(chatterUpdate(c, from('Bob', [], { channelId: 'b' }))).toBeUndefined()
  })
  it('follows a role change in a channel, and keeps the role in other channels', () => {
    let c = chatterUpdate(undefined, from('Bob', [], { channelId: 'a' }))!
    c = chatterUpdate(c, from('Bob', ['moderator/1'], { channelId: 'b' }))!
    expect(c.roles).toEqual({ '#a': 'viewer', '#b': 'moderator' })
    c = chatterUpdate(c, from('Bob', ['vip/1'], { channelId: 'b' }))! // no longer a moderator in b
    expect(c.roles['#b']).toBe('vip')
  })
  it('picks up a renamed display name', () => {
    const c = chatterUpdate(undefined, from('bob'))!
    expect(chatterUpdate(c, { ...from('Bob'), author: { id: 'id-bob', name: 'Bob', badges: [] } })!.name).toBe('Bob')
  })
  it('ignores event rows and nameless lines', () => {
    expect(chatterUpdate(undefined, from('Bob', [], { event: { type: 'sub', title: 'x' } }))).toBeUndefined()
    expect(chatterUpdate(undefined, from(''))).toBeUndefined()
  })
  it('chatterKey separates platforms and uses the id when there is one', () => {
    expect(chatterKey(from('Bob'))).toBe('twitch|id-Bob')
    expect(chatterKey(from('Bob', [], { platform: 'youtube' }))).toBe('youtube|id-Bob')
    expect(chatterKey(chatMessage({ author: { name: 'Bob', badges: [] } }))).toBe('twitch|bob')
  })
})

describe('topRole / roleDetail', () => {
  const c: Chatter = { platform: 'twitch', name: 'Bob', roles: { '#a': 'viewer', '#b': 'moderator' }, last: 'b' }
  it('lists the highest role across channels', () => {
    expect(topRole(c)).toBe('moderator')
  })
  it('explains the roles per channel, or just the role for one channel', () => {
    expect(roleDetail(c)).toBe('Viewer in #a, Moderator in #b')
    expect(roleDetail({ ...c, roles: { '#a': 'vip' } })).toBe('VIP')
  })
})

describe('groupChatters', () => {
  const person = (platform: Chatter['platform'], name: string, role: 'broadcaster' | 'moderator' | 'vip' | 'viewer'): Chatter => ({ platform, name, roles: { '#c': role }, last: 'c' })
  const all = [
    person('youtube', 'RandomYoutubeChatter', 'viewer'),
    person('twitch', 'zed', 'viewer'),
    person('twitch', 'Botleaf', 'moderator'),
    person('twitch', 'alice', 'viewer'),
    person('twitch', 'Nightleaf', 'broadcaster'),
    person('twitch', 'Vera', 'vip'),
    person('youtube', 'Nightleaf', 'broadcaster'),
    person('twitch', 'Bob', 'viewer')
  ]
  const shape = (g: ReturnType<typeof groupChatters>) => g.map((p) => [p.platform, p.total, p.roles.map((r) => [r.role, r.chatters.map((c) => c.name)])])

  it('platform, then role (broadcaster, moderator, VIP, viewer), then names A to Z ignoring case', () => {
    expect(shape(groupChatters(all))).toEqual([
      ['twitch', 6, [['broadcaster', ['Nightleaf']], ['moderator', ['Botleaf']], ['vip', ['Vera']], ['viewer', ['alice', 'Bob', 'zed']]]],
      ['youtube', 2, [['broadcaster', ['Nightleaf']], ['viewer', ['RandomYoutubeChatter']]]]
    ])
  })
  it('leaves out empty roles and platforms with nobody', () => {
    expect(shape(groupChatters([person('youtube', 'a', 'vip')]))).toEqual([['youtube', 1, [['vip', ['a']]]]])
    expect(groupChatters([])).toEqual([])
  })
  it('can hide platforms', () => {
    expect(groupChatters(all, (p) => p === 'youtube').map((g) => g.platform)).toEqual(['youtube'])
  })
  it('a person is listed once, under their highest role', () => {
    const both: Chatter = { platform: 'twitch', name: 'Bob', roles: { '#a': 'viewer', '#b': 'vip' }, last: 'b' }
    expect(shape(groupChatters([both]))).toEqual([['twitch', 1, [['vip', ['Bob']]]]])
  })
})
