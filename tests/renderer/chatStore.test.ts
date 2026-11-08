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

beforeEach(() => {
  useChatStore.setState({ ...initial, messages: [], activities: {}, enabled: { ...initial.enabled }, channels: { ...initial.channels } })
  apiCalls.length = 0
  storageBroken = false
})

describe('starting up', () => {
  it('restores the channels typed last time', () => {
    expect(initial.channels.twitch).toBe('saved_channel')
    expect(initial.channels.youtube).toBe('')
  })

  it('starts with everything off and signed out', () => {
    expect(Object.values(initial.enabled).every((on) => !on)).toBe(true)
    expect(initial.auth.status).toBe('signed-out')
    expect(initial.messages).toEqual([])
  })
})

describe('addItems', () => {
  it('appends messages in order', () => {
    s().addItems([msg('a'), msg('b')])
    s().addItems([msg('c')])
    expect(s().messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('applies a deletion to a message that arrived earlier in the SAME batch', () => {
    s().addItems([msg('a'), { kind: 'moderation', action: { type: 'delete-message', platform: 'twitch', channelId: 'chan', messageId: 'a' } }, msg('b')])
    expect(s().messages.map((m) => [m.id, m.removed])).toEqual([['a', 'deleted'], ['b', undefined]])
  })

  it('does not apply a ban to messages that arrive after it', () => {
    s().addItems([
      msg('old'),
      { kind: 'moderation', action: { type: 'clear-user', platform: 'twitch', channelId: 'chan', userId: 'u1', login: 'viewer' } },
      msg('new')
    ])
    expect(s().messages.map((m) => m.removed)).toEqual(['ban', undefined])
  })

  it('keeps only the newest 2000 messages', () => {
    s().addItems(Array.from({ length: 2105 }, (_, i) => msg(`m${i}`)))
    expect(s().messages).toHaveLength(2000)
    expect(s().messages[0].id).toBe('m105')
    expect(s().messages.at(-1)?.id).toBe('m2104')
  })

  it('keeps the same messages array when a batch changes nothing visible', () => {
    s().addItems([msg('a')])
    const before = s().messages
    s().addItems([])
    expect(s().messages).toBe(before)
  })

  describe('polls and predictions', () => {
    it('keeps the latest state of each one by key', () => {
      s().addItems([{ kind: 'activity', activity: poll('p1', { title: 'first' }) }])
      s().addItems([{ kind: 'activity', activity: poll('p1', { title: 'second' }) }, { kind: 'activity', activity: poll('p2') }])
      expect(Object.keys(s().activities).sort()).toEqual(['poll:p1', 'poll:p2'])
      expect(s().activities['poll:p1'].title).toBe('second')
    })

    it('forgets results more than 10 minutes after they ended', () => {
      const ended = poll('old', { status: 'completed', endedAt: Date.now() - 11 * 60_000 })
      const recent = poll('recent', { status: 'completed', endedAt: Date.now() - 60_000 })
      s().addItems([{ kind: 'activity', activity: ended }, { kind: 'activity', activity: recent }, { kind: 'activity', activity: poll('live') }])
      expect(Object.keys(s().activities).sort()).toEqual(['poll:live', 'poll:recent'])
    })

    it('does not bring back one the user closed', () => {
      const a = poll('dismissed-1')
      s().addItems([{ kind: 'activity', activity: a }])
      s().dismissActivity(activityKey(a))
      expect(s().activities).toEqual({})
      s().addItems([{ kind: 'activity', activity: { ...a, title: 'update' } }])
      expect(s().activities).toEqual({})
    })
  })
})

describe('platforms', () => {
  it('turning one on tells the main process, with the cleaned channel list', () => {
    s().setChannels('twitch', 'Foo, twitch.tv/bar !!!')
    apiCalls.length = 0
    s().togglePlatform('twitch')
    expect(s().enabled.twitch).toBe(true)
    expect(apiCalls).toEqual([['toggle', 'twitch', true, ['foo', 'bar']]])
    s().togglePlatform('twitch')
    expect(apiCalls.at(-1)).toEqual(['toggle', 'twitch', false, ['foo', 'bar']])
  })

  it('uses YouTube\'s rules for the YouTube box', () => {
    s().setChannels('youtube', '@MyChannel nonsense')
    s().togglePlatform('youtube')
    expect(apiCalls.at(-1)).toEqual(['toggle', 'youtube', true, ['@mychannel']])
  })

  it('switching Twitch off clears poll/prediction cards (they could never finish); other platforms do not', () => {
    s().addItems([{ kind: 'activity', activity: poll('p-toggle') }])
    s().togglePlatform('youtube')
    s().togglePlatform('youtube')
    expect(Object.keys(s().activities)).toEqual(['poll:p-toggle'])
    s().togglePlatform('twitch') // on
    expect(Object.keys(s().activities)).toEqual(['poll:p-toggle'])
    s().togglePlatform('twitch') // off
    expect(s().activities).toEqual({})
  })

  it('records each platform\'s status', () => {
    s().setStatus('twitch', { state: 'connected', detail: '#a' })
    expect(s().status.twitch).toEqual({ state: 'connected', detail: '#a' })
    expect(s().status.youtube.state).toBe('disconnected')
  })
})

describe('setChannels', () => {
  it('saves what was typed, exactly as typed', () => {
    s().setChannels('twitch', ' Foo ,bar')
    expect(s().channels.twitch).toBe(' Foo ,bar')
    expect(JSON.parse(store.get('hub.channels')!).twitch).toBe(' Foo ,bar')
  })

  it('applies the change live only while the platform is on', () => {
    s().setChannels('twitch', 'a b')
    expect(apiCalls).toEqual([])
    s().togglePlatform('twitch')
    apiCalls.length = 0
    s().setChannels('twitch', 'a b c')
    expect(apiCalls).toEqual([['channels', 'twitch', ['a', 'b', 'c']]])
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
