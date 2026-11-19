/**
 * tests/renderer/chatStore.test.ts
 *
 * The UI's chat state (a Zustand store): how batches of rows are added, moderation applied, the buffer
 * trimmed, platforms switched on/off, and polls/predictions kept or dropped. The window bridge
 * (`window.api`) and browser storage are replaced by fakes.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChannelActivity, ChatMessage, FeedItem } from '../../src/shared/types'
import { chatMessage } from '../helpers/factories'

// ---- fakes the store reads at start-up and during actions -------------------------------------
const apiCalls: [string, ...unknown[]][] = []
const record = (name: string) => (...args: unknown[]) => void apiCalls.push([name, ...args])
const store = new Map<string, string>([['hub.channels', JSON.stringify({ twitch: 'saved_channel' })]])
let storageBroken = false
const g = globalThis as Record<string, unknown>
g.window = { api: { setPlatformEnabled: record('toggle'), setChannels: record('channels'), setAlwaysOnTop: record('onTop') } }
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (storageBroken) throw new Error('quota')
    store.set(k, v)
  }
}

const { useChatStore, activityKey } = await import('../../src/renderer/src/store/chatStore')
const initial = useChatStore.getState()
const s = () => useChatStore.getState()

const msg = (id: string, over: Partial<ChatMessage> = {}): FeedItem => ({ kind: 'message', message: chatMessage({ id, ...over }) })
const poll = (id: string, over: Partial<Extract<ChannelActivity, { kind: 'poll' }>> = {}): ChannelActivity => ({
  kind: 'poll',
  id,
  channelId: 'chan',
  title: 'Which?',
  choices: [],
  status: 'active',
  startedAt: Date.now(),
  ...over
})

const NONE = { twitch: '', youtube: '', kick: '', x: '', tiktok: '' }
const OFF = { twitch: false, youtube: false, kick: false, x: false, tiktok: false }

beforeEach(() => {
  // Every test starts with no channels and nothing connected (the start-up tests use `initial` instead).
  useChatStore.setState({ ...initial, messages: [], activities: {}, pins: {}, enabled: { ...OFF }, channels: { ...NONE }, titleSource: '', chatters: new Map(), chattersOpen: false, chattersCollapsed: [] })
  apiCalls.length = 0
  storageBroken = false
})

describe('starting up', () => {
  it('restores the channels typed last time, and the platform that has them starts connected (resumes)', () => {
    expect(initial.channels.twitch).toBe('saved_channel')
    expect(initial.channels.youtube).toBe('')
    expect(initial.enabled.twitch).toBe(true)
    expect(initial.enabled.youtube).toBe(false)
  })

  it('starts signed out with no messages', () => {
    expect(initial.auth.status).toBe('signed-out')
    expect(initial.messages).toEqual([])
  })

  it('resume() reconnects each platform that has channels, with its cleaned list, and nothing else', () => {
    useChatStore.setState({ channels: { ...NONE, twitch: 'Foo, twitch.tv/bar !!!' }, enabled: { ...OFF, twitch: true } })
    s().resume()
    expect(apiCalls).toEqual([['toggle', 'twitch', true, ['foo', 'bar']]])
  })

  it('resume() does nothing when there are no channels', () => {
    s().resume()
    expect(apiCalls).toEqual([])
  })
})

describe('platforms follow their channels', () => {
  it('the first channel connects the platform; more channels apply live; removing the last disconnects it', () => {
    s().setChannels('twitch', 'Foo')
    expect(s().enabled.twitch).toBe(true)
    expect(apiCalls).toEqual([['toggle', 'twitch', true, ['foo']]])
    apiCalls.length = 0
    s().setChannels('twitch', 'Foo, twitch.tv/bar !!!')
    expect(apiCalls).toEqual([['channels', 'twitch', ['foo', 'bar']]])
    apiCalls.length = 0
    s().setChannels('twitch', '')
    expect(s().enabled.twitch).toBe(false)
    expect(apiCalls).toEqual([['toggle', 'twitch', false, []]])
  })

  it('uses YouTube\'s rules for YouTube channels', () => {
    s().setChannels('youtube', '@MyChannel nonsense')
    expect(s().enabled.youtube).toBe(true)
    expect(apiCalls.at(-1)).toEqual(['toggle', 'youtube', true, ['@mychannel']])
  })

  it('text with no valid channel does not connect anything', () => {
    s().setChannels('twitch', '!!! ???')
    expect(s().enabled.twitch).toBe(false)
    expect(apiCalls).toEqual([])
  })

  it('disconnecting Twitch clears poll/prediction cards (they could never finish); other platforms do not', () => {
    s().addItems([{ kind: 'activity', activity: poll('p-toggle') }])
    s().setChannels('youtube', '@aaa')
    s().setChannels('youtube', '')
    expect(Object.keys(s().activities)).toEqual(['poll:p-toggle'])
    s().setChannels('twitch', 'a') // connect
    expect(Object.keys(s().activities)).toEqual(['poll:p-toggle'])
    s().setChannels('twitch', '') // disconnect
    expect(s().activities).toEqual({})
  })

  it('records each platform\'s status', () => {
    s().setStatus('twitch', { state: 'connected', detail: '#a' })
    expect(s().status.twitch).toEqual({ state: 'connected', detail: '#a' })
    expect(s().status.youtube.state).toBe('disconnected')
  })
})

describe('adding and removing channels', () => {
  const titles = () => s().messages.filter((m) => m.event?.type === 'break').map((m) => m.event?.title)

  it('rejects text that is not a channel, with a reason', () => {
    const r = s().addChannel('twitch', '!!!')
    expect(r.ok).toBe(false)
    expect('error' in r && r.error).toMatch(/Twitch channel name/)
    const y = s().addChannel('youtube', 'plainword')
    expect('error' in y && y.error).toMatch(/@handle/)
  })

  it('the first channel added connects the platform, marks the join, and becomes the title source', () => {
    expect(s().addChannel('twitch', 'twitch.tv/One')).toEqual({ ok: true, added: ['one'] })
    expect(s().channels.twitch).toBe('one')
    expect(s().enabled.twitch).toBe(true)
    expect(apiCalls).toEqual([['toggle', 'twitch', true, ['one']]])
    expect(titles()).toEqual(['Joined #one'])
    expect(s().titleSource).toBe('twitch:one')
    expect(JSON.parse(store.get('hub.channels')!).twitch).toBe('one')
    expect(store.get('hub.titleSource')).toBe('twitch:one')
  })

  it('later channels apply live, mark the join, and leave the title source alone (even on another platform)', () => {
    s().addChannel('twitch', 'one')
    apiCalls.length = 0
    expect(s().addChannel('twitch', 'two, three')).toEqual({ ok: true, added: ['two', 'three'] })
    expect(apiCalls).toEqual([['channels', 'twitch', ['one', 'two', 'three']]])
    expect(s().addChannel('youtube', '@later')).toEqual({ ok: true, added: ['@later'] })
    expect(apiCalls.at(-1)).toEqual(['toggle', 'youtube', true, ['@later']])
    expect(titles()).toEqual(['Joined #one', 'Joined #two', 'Joined #three', 'Joined @later'])
    expect(s().titleSource).toBe('twitch:one')
  })

  it('a YouTube channel added first is the title source even though Twitch is listed first', () => {
    s().addChannel('youtube', '@first')
    s().addChannel('twitch', 'second')
    expect(s().titleSource).toBe('youtube:@first')
  })

  it('refuses a channel that is already there, and mentions only the new ones when some are', () => {
    s().addChannel('twitch', 'one')
    const r = s().addChannel('twitch', 'ONE')
    expect('error' in r && r.error).toMatch(/already in your feed/)
    expect(s().addChannel('twitch', 'one, fresh')).toEqual({ ok: true, added: ['fresh'] })
  })

  it('refuses to go past the platform limit', () => {
    s().setChannels('youtube', '@aaa, @bbb, @ccc, @ddd, @eee')
    const r = s().addChannel('youtube', '@fff')
    expect('error' in r && r.error).toMatch(/at most 5/)
    expect(s().channels.youtube).toBe('@aaa, @bbb, @ccc, @ddd, @eee')
  })

  it('removing a channel marks the leave; removing the last one disconnects the platform', () => {
    s().addChannel('twitch', 'one, two')
    apiCalls.length = 0
    s().removeChannel('twitch', 'one')
    expect(s().channels.twitch).toBe('two')
    expect(apiCalls).toEqual([['channels', 'twitch', ['two']]])
    s().removeChannel('twitch', 'two')
    expect(s().channels.twitch).toBe('')
    expect(s().enabled.twitch).toBe(false)
    expect(apiCalls.at(-1)).toEqual(['toggle', 'twitch', false, []])
    expect(titles()).toEqual(['Joined #one', 'Joined #two', 'Left #one', 'Left #two'])
    s().removeChannel('twitch', 'never-added') // unknown: ignored
    expect(titles()).toHaveLength(4)
  })

  it('setTitleSource saves the choice', () => {
    s().setTitleSource('youtube:@x')
    expect(s().titleSource).toBe('youtube:@x')
    expect(store.get('hub.titleSource')).toBe('youtube:@x')
  })
})

describe('chatters', () => {
  const said = (id: string, name: string, badges: string[] = [], over: Partial<ChatMessage> = {}): FeedItem => ({
    kind: 'message',
    message: chatMessage({ id, author: { id: `u-${name}`, name, badges: badges.map((b) => ({ id: b, label: '' })) }, ...over })
  })

  it('remembers everyone who chats, once, with their role', () => {
    s().addItems([said('c1', 'Bob'), said('c2', 'Botleaf', ['moderator/1']), said('c3', 'Bob')])
    expect([...s().chatters.values()].map((c) => [c.name, Object.values(c.roles)[0]])).toEqual([['Bob', 'viewer'], ['Botleaf', 'moderator']])
  })

  it('keeps them after their messages are trimmed away, and ignores events', () => {
    s().addItems([said('c4', 'Early')])
    s().addItems(Array.from({ length: 2100 }, (_, i) => said(`flood${i}`, 'Flooder')))
    expect(s().messages.some((m) => m.author.name === 'Early')).toBe(false)
    expect([...s().chatters.values()].some((c) => c.name === 'Early')).toBe(true)
    s().addItems([{ kind: 'message', message: chatMessage({ id: 'ev1', name: 'Gifter', event: { type: 'sub', title: 'x' } }) }])
    expect([...s().chatters.values()].some((c) => c.name === 'Gifter')).toBe(false)
  })

  it('a role change is picked up, and the Map is replaced (so the UI updates) only when something changed', () => {
    s().addItems([said('c5', 'Pat')])
    const before = s().chatters
    s().addItems([said('c6', 'Pat')]) // same name, same role
    expect(s().chatters).toBe(before)
    s().addItems([said('c7', 'Pat', ['vip/1'])])
    expect(s().chatters).not.toBe(before)
    expect(Object.values([...s().chatters.values()].find((c) => c.name === 'Pat')!.roles)).toEqual(['vip'])
  })

  it('Clear empties the list too', () => {
    s().addItems([said('c8', 'Gone')])
    s().clear()
    expect(s().chatters.size).toBe(0)
  })

  it('collapses and expands one platform\'s section, and remembers it', () => {
    expect(s().chattersCollapsed).toEqual([])
    s().toggleChattersPlatform('twitch')
    s().toggleChattersPlatform('youtube')
    expect(s().chattersCollapsed).toEqual(['twitch', 'youtube'])
    expect(JSON.parse(store.get('hub.chattersCollapsed')!)).toEqual(['twitch', 'youtube'])
    s().toggleChattersPlatform('twitch')
    expect(s().chattersCollapsed).toEqual(['youtube'])
  })

  it('remembers whether the panel is open', () => {
    expect(s().chattersOpen).toBe(false)
    s().toggleChatters()
    expect(s().chattersOpen).toBe(true)
    expect(store.get('hub.chattersOpen')).toBe('1')
    s().toggleChatters()
    expect(store.get('hub.chattersOpen')).toBe('0')
  })
})

describe('setChannels', () => {
  it('saves what was typed, exactly as typed', () => {
    s().setChannels('twitch', ' Foo ,bar')
    expect(s().channels.twitch).toBe(' Foo ,bar')
    expect(JSON.parse(store.get('hub.channels')!).twitch).toBe(' Foo ,bar')
  })

  it('still works in memory when storage is full or blocked', () => {
    storageBroken = true
    expect(() => s().setChannels('twitch', 'x')).not.toThrow()
    expect(s().channels.twitch).toBe('x')
  })
})

describe('auth', () => {
  const signedIn = (canReadPolls?: boolean) => ({ status: 'signed-in' as const, configured: true, login: 'me', canReadPolls })

  it('keeps cards while signed in with the polls permission', () => {
    s().addItems([{ kind: 'activity', activity: poll('p-auth-1') }])
    s().setAuth(signedIn(true))
    expect(Object.keys(s().activities)).toEqual(['poll:p-auth-1'])
  })

  it('clears stale cards without the permission or after signing out', () => {
    s().addItems([{ kind: 'activity', activity: poll('p-auth-2') }])
    s().setAuth(signedIn(false))
    expect(s().activities).toEqual({})
    s().addItems([{ kind: 'activity', activity: poll('p-auth-3') }])
    s().setAuth({ status: 'signed-out', configured: true })
    expect(s().activities).toEqual({})
  })

  it('stores the new state', () => {
    s().setAuth(signedIn(true))
    expect(s().auth).toMatchObject({ status: 'signed-in', login: 'me' })
  })
})

describe('small actions', () => {
  it('toggles events, clears messages and tells main about "pin on top"', () => {
    s().toggleEvents()
    expect(s().showEvents).toBe(false)
    s().addItems([msg('x')])
    s().clear()
    expect(s().messages).toEqual([])
    s().toggleAlwaysOnTop()
    expect(s().alwaysOnTop).toBe(true)
    expect(apiCalls.at(-1)).toEqual(['onTop', true])
  })

  it('shows a toast, replacing any earlier one', () => {
    s().showToast('first')
    s().showToast('second', 'error')
    expect(s().toast).toEqual({ text: 'second', kind: 'error' })
  })
})

describe('the same row is never added twice', () => {
  it('drops a repeat of a message id, in a later batch or in the same batch', () => {
    s().addItems([msg('dup-1', { channelId: 'a' })])
    s().addItems([msg('dup-1', { channelId: 'a' })])
    s().addItems([msg('dup-2'), msg('dup-2')])
    expect(s().messages.map((m) => m.id)).toEqual(['dup-1', 'dup-2'])
  })

  it('does not drop different messages, and still applies moderation to the kept one', () => {
    s().addItems([msg('keep-1'), msg('keep-2')])
    s().addItems([{ kind: 'moderation', action: { type: 'delete-message', platform: 'twitch', channelId: 'chan', messageId: 'keep-1' } }])
    expect(s().messages.map((m) => m.id)).toEqual(['keep-1', 'keep-2'])
    expect(s().messages[0].removed).toBe('deleted')
  })

  it('a repeated "Poll ended" row (same id) shows once', () => {
    const ended = msg('activity-poll-p9-end', { event: { type: 'poll', title: 'Poll ended' } })
    s().addItems([ended])
    s().addItems([ended, ended])
    expect(s().messages.filter((m) => m.id === 'activity-poll-p9-end')).toHaveLength(1)
  })
})

describe('pinned messages', () => {
  const pin = (over: Partial<Extract<FeedItem, { kind: 'pin' }>['pin']> = {}): FeedItem => ({
    kind: 'pin',
    pin: { platform: 'twitch', channelId: 'chan', messageId: 'pm1', author: { name: 'Mod' }, parts: [{ type: 'text', value: 'Rules' }], ...over }
  })

  it('stores a pin per channel and replaces it with a newer one', () => {
    s().addItems([pin()])
    expect(Object.keys(s().pins)).toEqual(['twitch:chan'])
    s().addItems([pin({ messageId: 'pm2' })])
    expect(s().pins['twitch:chan'].messageId).toBe('pm2')
    expect(Object.keys(s().pins)).toHaveLength(1)
  })

  it('removes a pin on unpin, and ignores an unpin for a channel without one', () => {
    s().addItems([pin({ channelId: 'x1' })])
    s().addItems([{ kind: 'unpin', platform: 'twitch', channelId: 'x1' }])
    expect(s().pins['twitch:x1']).toBeUndefined()
    const before = s().pins
    s().addItems([{ kind: 'unpin', platform: 'twitch', channelId: 'never' }])
    expect(s().pins).toBe(before)
  })

  it('a closed pin stays closed, but a different pin shows again', () => {
    s().addItems([pin({ channelId: 'c1', messageId: 'a' })])
    s().dismissPin('twitch:c1')
    expect(s().pins['twitch:c1']).toBeUndefined()
    s().addItems([pin({ channelId: 'c1', messageId: 'a' })]) // the same pin is reported again
    expect(s().pins['twitch:c1']).toBeUndefined()
    s().addItems([pin({ channelId: 'c1', messageId: 'b' })])
    expect(s().pins['twitch:c1'].messageId).toBe('b')
  })

  it('switching a platform off removes its pins only', () => {
    s().addItems([pin({ channelId: 'c2' }), pin({ platform: 'youtube', channelId: 'vid12345678', messageId: 'y1' })])
    s().setChannels('twitch', 'c2chan')
    s().setChannels('twitch', '') // disconnecting Twitch drops its pins
    expect(s().pins['twitch:c2']).toBeUndefined()
    expect(s().pins['youtube:vid12345678']).toBeDefined()
  })
})
