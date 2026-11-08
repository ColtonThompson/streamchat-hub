/**
 * tests/renderer/moderation.test.ts
 *
 * When Twitch says a message was deleted or a user was timed out/banned, matching rows get marked removed.
 */
import { describe, expect, it } from 'vitest'
import { applyModeration } from '../../src/renderer/src/lib/moderation'
import type { ModerationEvent } from '../../src/shared/types'
import { chatMessage } from '../helpers/factories'

const del = (messageId: string, channelId = 'chan'): ModerationEvent => ({ type: 'delete-message', platform: 'twitch', channelId, messageId })
const clearUser = (extra: Partial<Extract<ModerationEvent, { type: 'clear-user' }>>): ModerationEvent => ({
  type: 'clear-user',
  platform: 'twitch',
  channelId: 'chan',
  login: 'viewer',
  ...extra
})

describe('applyModeration', () => {
  it('marks one deleted message', () => {
    const a = chatMessage({ id: 'a' })
    const b = chatMessage({ id: 'b' })
    const out = applyModeration([a, b], del('b'))
    expect(out[0]).toBe(a)
    expect(out[1].removed).toBe('deleted')
  })

  it('marks every message of a banned user (matched by id) as removed by ban', () => {
    const msgs = [chatMessage({ id: 'a', name: 'Viewer' }), chatMessage({ id: 'b', name: 'Other', author: { id: 'u2', name: 'Other', badges: [] } }), chatMessage({ id: 'c', name: 'Viewer' })]
    const out = applyModeration(msgs, clearUser({ userId: 'u1' }))
    expect(out.map((m) => m.removed)).toEqual(['ban', undefined, 'ban'])
  })

  it('marks timeouts differently from bans', () => {
    const out = applyModeration([chatMessage()], clearUser({ userId: 'u1', durationSec: 60 }))
    expect(out[0].removed).toBe('timeout')
  })

  it('prefers the user id: a different person with the same display name is untouched', () => {
    const imposter = chatMessage({ author: { id: 'u99', name: 'Viewer', badges: [] } })
    expect(applyModeration([imposter], clearUser({ userId: 'u1' }))[0].removed).toBeUndefined()
  })

  it('falls back to the lower-cased login when there is no user id', () => {
    const out = applyModeration([chatMessage({ author: { name: 'ViEwEr', badges: [] } })], clearUser({ login: 'viewer' }))
    expect(out[0].removed).toBe('ban')
  })

  it('only affects the same platform and channel', () => {
    const other = chatMessage({ channelId: 'elsewhere' })
    const yt = chatMessage({ platform: 'youtube' })
    const out = applyModeration([other, yt], clearUser({ userId: 'u1' }))
    expect(out[0].removed).toBeUndefined()
    expect(out[1].removed).toBeUndefined()
  })

  it('leaves already-removed messages alone', () => {
    const m = chatMessage({ removed: 'deleted' })
    expect(applyModeration([m], clearUser({ userId: 'u1' }))[0].removed).toBe('deleted')
  })

  it('returns the SAME array when nothing matched (so the UI does not re-render)', () => {
    const list = [chatMessage({ id: 'a' })]
    expect(applyModeration(list, del('nope'))).toBe(list)
  })

  it('never modifies the original message objects', () => {
    const m = chatMessage({ id: 'a' })
    const out = applyModeration([m], del('a'))
    expect(m.removed).toBeUndefined()
    expect(out[0]).not.toBe(m)
  })
})
