/** tests/renderer/pings.test.ts: which messages @mention you. */
import { describe, expect, it } from 'vitest'
import { cleanPingName, findPing, pingNamesFor } from '../../src/renderer/src/lib/pings'
import type { ChatMessage } from '../../src/shared/types'

function msg(text: string, over: Partial<ChatMessage> = {}, author = 'Bob'): ChatMessage {
  return { id: 'm', platform: 'twitch', channelId: 'c', author: { name: author, badges: [] }, parts: [{ type: 'text', value: text }], timestamp: 1, ...over } as ChatMessage
}

describe('pingNamesFor / cleanPingName', () => {
  it('cleans names and merges login with extras', () => {
    expect(cleanPingName(' @MyName ')).toBe('myname')
    expect(cleanPingName('no')).toBeUndefined()
    expect(cleanPingName('has space')).toBeUndefined()
    expect(pingNamesFor('Colton', ['@Handle', 'colton', 'x'])).toEqual(['colton', 'handle'])
    expect(pingNamesFor(undefined, [])).toEqual([])
  })
})

describe('findPing', () => {
  const names = ['colton', 'handle']
  it('matches @name ignoring case, on any platform', () => {
    expect(findPing(msg('hey @Colton nice'), names)).toBe('colton')
    expect(findPing(msg('yo @handle!', { platform: 'youtube' }), names)).toBe('handle')
  })
  it('ignores plain names, emails, other names, your own lines, events and removed lines', () => {
    expect(findPing(msg('colton is here'), names)).toBeUndefined()
    expect(findPing(msg('mail me@colton.com'), names)).toBeUndefined()
    expect(findPing(msg('@coltonx hi'), names)).toBeUndefined()
    expect(findPing(msg('@colton hi', {}, 'Colton'), names)).toBeUndefined()
    expect(findPing(msg('@colton', { removed: 'deleted' }), names)).toBeUndefined()
    expect(findPing(msg('@colton', { event: { type: 'sub' } as never }), names)).toBeUndefined()
    expect(findPing(msg('@colton'), [])).toBeUndefined()
  })
})
