/** tests/renderer/modpanel.test.ts: who opens the moderator panel, its history, status and hotkeys. */
import { describe, expect, it } from 'vitest'
import { modKeyAction, modTargetFor, userHistory, userStatus } from '../../src/renderer/src/lib/modpanel'
import type { ChatMessage } from '../../src/shared/types'

function msg(over: Partial<ChatMessage> & { uid?: string; badges?: string[] } = {}): ChatMessage {
  const { uid = 'u1', badges = [], ...rest } = over
  return {
    id: 'm' + Math.random(),
    platform: 'twitch',
    channelId: 'chan',
    author: { id: uid, name: 'Bob', badges: badges.map((id) => ({ id, label: id, imageUrl: '' })) },
    parts: [{ type: 'text', text: 'hi' }],
    timestamp: 1,
    ...rest
  } as ChatMessage
}
const mod = { canModerate: true, userId: 'me' }

describe('modTargetFor', () => {
  it('opens for a normal Twitch line when moderating', () => {
    expect(modTargetFor(msg(), mod)).toMatchObject({ userId: 'u1', name: 'Bob', channelId: 'chan' })
  })
  it('opens history-only for yourself and the broadcaster', () => {
    expect(modTargetFor(msg(), mod)?.readOnly).toBeUndefined()
    expect(modTargetFor(msg({ uid: 'me' }), mod)?.readOnly).toBe(true)
    expect(modTargetFor(msg({ badges: ['broadcaster/1'] }), mod)?.readOnly).toBe(true)
  })
  it('does not without moderation tools, removed, or other platforms', () => {
    expect(modTargetFor(msg(), { canModerate: false, userId: 'me' })).toBeUndefined()
    expect(modTargetFor(msg({ removed: 'ban' }), mod)).toBeUndefined()
    expect(modTargetFor(msg({ platform: 'youtube' }), mod)).toBeUndefined()
  })
})

describe('userHistory / userStatus', () => {
  const t = { platform: 'twitch' as const, channelId: 'chan', userId: 'u1', name: 'Bob' }
  it('keeps only that person in that channel', () => {
    const a = msg(), b = msg({ uid: 'u2' }), c = msg({ channelId: 'other' })
    expect(userHistory([a, b, c], t)).toEqual([a])
  })
  it('reads status from the latest removed line', () => {
    expect(userStatus([msg()])).toBeUndefined()
    expect(userStatus([msg({ removed: 'deleted' })])).toBeUndefined()
    expect(userStatus([msg({ removed: 'timeout' })])).toBe('timeout')
    expect(userStatus([msg({ removed: 'timeout' }), msg({ removed: 'ban' })])).toBe('banned')
  })
})

describe('modKeyAction', () => {
  it('maps keys and ignores modifiers', () => {
    expect(modKeyAction({ key: 'b' })).toBe('ban')
    expect(modKeyAction({ key: 'T' })).toBe('timeout')
    expect(modKeyAction({ key: 'u' })).toBe('unban')
    expect(modKeyAction({ key: 'Escape' })).toBe('close')
    expect(modKeyAction({ key: 'b', ctrlKey: true })).toBeUndefined()
    expect(modKeyAction({ key: 'x' })).toBeUndefined()
  })
})
