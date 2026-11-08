/**
 * tests/main/helix.test.ts
 *
 * The Twitch web API client against a fake `fetch`: what it sends (URLs, headers, bodies), how it reads
 * answers, how it words failures for the user, and the retry after an expired token.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Helix, HelixError } from '../../src/main/twitch/helix'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

const realFetch = globalThis.fetch
let calls: Call[] = []
let replies: Response[] = []

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const reply = (...r: Response[]) => (replies = r)

function fakeAuth(over: { token?: string | undefined; refresh?: () => Promise<boolean> } = {}) {
  const state = { token: 'tok' as string | undefined, refreshes: 0 }
  if ('token' in over) state.token = over.token
  return {
    state,
    auth: {
      clientId: 'cid',
      getAccessToken: async () => state.token,
      refresh: async () => {
        state.refreshes++
        return over.refresh ? over.refresh() : true
      }
    }
  }
}

const helix = (over: Parameters<typeof fakeAuth>[0] = {}) => {
  const f = fakeAuth(over)
  return { h: new Helix(f.auth as never), ...f }
}

beforeEach(() => {
  calls = []
  replies = []
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined })
    return replies.shift() ?? json({})
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('every request', () => {
  it('sends the token and the app client id', async () => {
    reply(json({ data: [] }))
    await helix().h.getBadges()
    expect(calls[0].headers.Authorization).toBe('Bearer tok')
    expect(calls[0].headers['Client-Id']).toBe('cid')
  })

  it('does nothing and reports "signed out" when there is no token', async () => {
    const { h } = helix({ token: undefined })
    expect(await h.getBadges()).toBeUndefined()
    expect(await h.sendChat('1', '2', 'hi')).toEqual({ ok: false, error: 'Sign in to Twitch to send messages.' })
    expect(await h.getFollowedStreams('2')).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('refreshes an expired token (401) and retries once', async () => {
    reply(json({}, 401), json({ data: [{ set_id: 'vip', versions: [] }] }))
    const { h, state } = helix()
    expect(await h.getBadges()).toEqual([{ set_id: 'vip', versions: [] }])
    expect(state.refreshes).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it('gives up after a second 401, or when the refresh fails', async () => {
    reply(json({ message: 'nope' }, 401), json({ message: 'nope' }, 401))
    const first = helix()
    expect(await first.h.deleteMessage('1', '2', 'm')).toEqual({ ok: false, error: 'Your Twitch login has expired. Sign in again.' })
    expect(calls).toHaveLength(2)

    calls = []
    reply(json({}, 401))
    const second = helix({ refresh: async () => false })
    expect((await second.h.deleteMessage('1', '2', 'm')).ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe('badges', () => {
  it('asks for global badges, or a channel\'s own', async () => {
    reply(json({ data: [] }), json({ data: [] }))
    const { h } = helix()
    await h.getBadges()
    await h.getBadges('42')
    expect(calls[0].url).toBe('https://api.twitch.tv/helix/chat/badges/global')
    expect(calls[1].url).toBe('https://api.twitch.tv/helix/chat/badges?broadcaster_id=42')
  })

  it('throws on an HTTP error so callers can tell it from "no badges"', async () => {
    reply(json({}, 500))
    await expect(helix().h.getBadges()).rejects.toThrow('HTTP 500')
  })
})

describe('sendChat', () => {
  it('posts the message as the signed-in user', async () => {
    reply(json({ data: [{ is_sent: true }] }))
    expect(await helix().h.sendChat('B', 'S', 'hello')).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({ method: 'POST', body: { broadcaster_id: 'B', sender_id: 'S', message: 'hello' } })
  })

  it('reports why Twitch dropped a message that came back 200', async () => {
    reply(json({ data: [{ is_sent: false, drop_reason: { message: 'Slow mode is on' } }] }))
    expect(await helix().h.sendChat('B', 'S', 'x')).toEqual({ ok: false, error: 'Slow mode is on' })
    reply(json({ data: [{ is_sent: false }] }))
    expect((await helix().h.sendChat('B', 'S', 'x')).error).toBe('Twitch did not accept that message.')
  })

  it('words HTTP failures for the user', async () => {
    reply(json({ message: 'Missing scope' }, 403))
    expect((await helix().h.sendChat('B', 'S', 'x')).error).toContain('broadcaster or moderator')
    reply(json({}, 429))
    expect((await helix().h.sendChat('B', 'S', 'x')).error).toContain('limiting how fast')
    reply(json({ message: 'user is already banned' }, 400))
    expect((await helix().h.sendChat('B', 'S', 'x')).error).toBe('user is already banned')
    reply(new Response('not json', { status: 502 }))
    expect((await helix().h.sendChat('B', 'S', 'x')).error).toBe('Twitch returned 502')
  })
})

describe('moderation', () => {
  it('deletes one message', async () => {
    reply(new Response(null, { status: 204 }))
    expect(await helix().h.deleteMessage('B', 'MOD', 'MSG')).toEqual({ ok: true })
    const url = new URL(calls[0].url)
    expect(calls[0].method).toBe('DELETE')
    expect(url.pathname).toBe('/helix/moderation/chat')
    expect(Object.fromEntries(url.searchParams)).toEqual({ broadcaster_id: 'B', moderator_id: 'MOD', message_id: 'MSG' })
  })

  it('times a user out (with a duration) or bans (without)', async () => {
    reply(json({}), json({}))
    const { h } = helix()
    await h.ban('B', 'MOD', 'U', 600)
    await h.ban('B', 'MOD', 'U')
    expect(calls[0]).toMatchObject({ method: 'POST', body: { data: { user_id: 'U', duration: 600 } } })
    expect(calls[1].body).toEqual({ data: { user_id: 'U' } })
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ broadcaster_id: 'B', moderator_id: 'MOD' })
  })

  it('lifts a ban', async () => {
    reply(json({}))
    await helix().h.unban('B', 'MOD', 'U')
    expect(calls[0].method).toBe('DELETE')
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ broadcaster_id: 'B', moderator_id: 'MOD', user_id: 'U' })
  })

  it('percent-encodes odd characters in ids', async () => {
    reply(json({}))
    await helix().h.deleteMessage('B', 'MOD', 'a&b=c d')
    expect(calls[0].url).not.toContain('a&b=c d')
    expect(new URL(calls[0].url).searchParams.get('message_id')).toBe('a&b=c d')
  })
})

describe('subscribeEventSub', () => {
  it('subscribes one event type on a WebSocket session', async () => {
    reply(json({}, 202))
    expect(await helix().h.subscribeEventSub('channel.poll.begin', '42', 'SES')).toEqual({ ok: true })
    expect(calls[0].body).toEqual({
      type: 'channel.poll.begin',
      version: '1',
      condition: { broadcaster_user_id: '42' },
      transport: { method: 'websocket', session_id: 'SES' }
    })
  })

  it('explains a refusal and passes other messages through', async () => {
    reply(json({}, 403))
    expect((await helix().h.subscribeEventSub('t', '1', 's')).error).toContain('polls & predictions')
    reply(json({ message: 'too many subscriptions' }, 429))
    expect((await helix().h.subscribeEventSub('t', '1', 's')).error).toBe('too many subscriptions')
  })
})

describe('getFollowedStreams', () => {
  const stream = (n: number, over: object = {}) => ({ user_id: String(n), user_login: `login${n}`, user_name: `Name${n}`, game_name: 'Hades II', title: 'cozy', viewer_count: n * 10, type: 'live', ...over })

  it('maps the live channels you follow', async () => {
    reply(json({ data: [stream(1)] }))
    expect(await helix().h.getFollowedStreams('ME')).toEqual([{ userId: '1', login: 'login1', name: 'Name1', game: 'Hades II', title: 'cozy', viewers: 10, live: true }])
    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/helix/streams/followed')
    expect(url.searchParams.get('user_id')).toBe('ME')
    expect(url.searchParams.get('first')).toBe('100')
  })

  it('fills gaps: display name from login, empty game/title, zero viewers', async () => {
    reply(json({ data: [{ user_id: '5', user_login: 'quiet', type: 'live' }] }))
    expect((await helix().h.getFollowedStreams('ME'))![0]).toEqual({ userId: '5', login: 'quiet', name: 'quiet', game: '', title: '', viewers: 0, live: true })
  })

  it('marks non-"live" entries (reruns) as not live and skips malformed ones', async () => {
    reply(json({ data: [stream(1, { type: 'rerun' }), { user_login: 'no-id' }, { user_id: '9' }, stream(2)] }))
    const out = (await helix().h.getFollowedStreams('ME'))!
    expect(out.map((s) => [s.login, s.live])).toEqual([['login1', false], ['login2', true]])
  })

  it('follows the cursor while pages are full, and stops at 3 pages', async () => {
    const page = (start: number) => json({ data: Array.from({ length: 100 }, (_, i) => stream(start + i)), pagination: { cursor: `c${start}` } })
    reply(page(0), page(100), page(200), page(300))
    const out = (await helix().h.getFollowedStreams('ME'))!
    expect(out).toHaveLength(300)
    expect(calls).toHaveLength(3)
    expect(new URL(calls[1].url).searchParams.get('after')).toBe('c0')
    expect(new URL(calls[2].url).searchParams.get('after')).toBe('c100')
  })

  it('stops when a page is not full even if a cursor is given', async () => {
    reply(json({ data: [stream(1)], pagination: { cursor: 'more' } }))
    await helix().h.getFollowedStreams('ME')
    expect(calls).toHaveLength(1)
  })

  it('returns an empty list when nobody is live', async () => {
    reply(json({ data: [] }))
    expect(await helix().h.getFollowedStreams('ME')).toEqual([])
  })

  it('throws a HelixError carrying the status, so a lost permission can be told from a network blip', async () => {
    reply(json({ message: 'Missing scope: user:read:follows' }, 401), json({ message: 'Missing scope: user:read:follows' }, 401))
    const err = await helix().h.getFollowedStreams('ME').catch((e) => e)
    expect(err).toBeInstanceOf(HelixError)
    expect(err.status).toBe(401)
  })
})
