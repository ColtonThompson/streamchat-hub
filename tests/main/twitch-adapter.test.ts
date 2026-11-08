/**
 * tests/main/twitch-adapter.test.ts
 *
 * The Twitch chat connection against a fake WebSocket server: login handshake, joining channels, replying
 * to keepalives, turning lines into messages/events/moderation, and reconnecting after a drop.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import WebSocketStub from 'ws'
import { TwitchAdapter } from '../../src/main/adapters/twitch'
import type { ChatMessage, ModerationEvent, PlatformStatus } from '../../src/shared/types'
import { fastTimers, sleep } from '../helpers/timers'

// The stub (tests/stubs/ws.ts) records every instance and what was sent on it.
const WS = WebSocketStub as unknown as { instances: (WebSocketStub & { sent: string[]; closed: boolean })[] }
const sockets = () => WS.instances

function make(channels: string[] = ['pixelwitch']) {
  const out = { messages: [] as ChatMessage[], moderation: [] as ModerationEvent[], statuses: [] as PlatformStatus[], ready: [] as [string, string][], order: [] as string[] }
  const adapter = new TwitchAdapter(
    {
      message: (m) => (out.messages.push(m), out.order.push('message')),
      moderation: (a) => (out.moderation.push(a), out.order.push('moderation')),
      status: (s) => out.statuses.push(s),
      channelReady: (c, id) => out.ready.push([c, id])
    },
    channels
  )
  return { adapter, out }
}

/** Connect, let the socket "open" and have Twitch welcome us. */
async function connected(channels?: string[]) {
  const m = make(channels)
  await m.adapter.connect()
  const ws = sockets()[0]
  ws.emit('open')
  ws.emit('message', ':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!\r\n')
  return { ...m, ws }
}

const line = (tags: string, rest: string) => `@${tags} ${rest}\r\n`
const chat = (id: string, text: string) => line(`id=${id};room-id=99;display-name=Viewer;tmi-sent-ts=1700000000000`, `:viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #pixelwitch :${text}`)

beforeEach(() => {
  sockets().length = 0
})

describe('connecting', () => {
  it('announces "connecting", then logs in anonymously with the right capabilities', async () => {
    const { adapter, out } = make()
    await adapter.connect()
    expect(out.statuses[0]).toMatchObject({ state: 'connecting' })
    const ws = sockets()[0]
    expect(ws.url).toBe('wss://irc-ws.chat.twitch.tv:443')
    ws.emit('open')
    expect(ws.sent[0]).toBe('CAP REQ :twitch.tv/tags twitch.tv/commands')
    expect(ws.sent[1]).toMatch(/^PASS /)
    expect(ws.sent[2]).toMatch(/^NICK justinfan\d+$/)
    adapter.disconnect()
  })

  it('joins the wanted channels only after Twitch welcomes us, then reports connected', async () => {
    const { adapter, out } = make(['a', 'b'])
    await adapter.connect()
    const ws = sockets()[0]
    ws.emit('open')
    expect(ws.sent.some((s) => s.startsWith('JOIN'))).toBe(false)
    ws.emit('message', ':tmi.twitch.tv 001 justinfan1 :Welcome\r\n')
    expect(ws.sent.at(-1)).toBe('JOIN #a,#b')
    expect(out.statuses.at(-1)).toEqual({ state: 'connected', detail: '#a #b' })
    adapter.disconnect()
  })

  it('says what to do when there are no channels yet', async () => {
    const { adapter, out } = await connected([])
    expect(out.statuses.at(-1)).toMatchObject({ state: 'connected', detail: 'add a channel to start reading' })
    adapter.disconnect()
  })

  it('answers keepalive pings', async () => {
    const { adapter, ws } = await connected()
    ws.emit('message', 'PING :tmi.twitch.tv\r\n')
    expect(ws.sent.at(-1)).toBe('PONG :tmi.twitch.tv')
    adapter.disconnect()
  })

  it('reports a failed login', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', ':tmi.twitch.tv NOTICE * :Login unsuccessful\r\n')
    expect(out.statuses.at(-1)).toMatchObject({ state: 'error', detail: 'Login unsuccessful' })
    adapter.disconnect()
  })

  it('reports socket errors', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('error', new Error('boom'))
    expect(out.statuses.at(-1)).toEqual({ state: 'error', detail: 'boom' })
    adapter.disconnect()
  })
})

describe('reading chat', () => {
  it('emits every message in a frame that holds several lines', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', chat('1', 'first') + chat('2', 'second'))
    expect(out.messages.map((m) => m.id)).toEqual(['1', '2'])
    expect(out.messages[1].parts).toEqual([{ type: 'text', value: 'second' }])
    adapter.disconnect()
  })

  it('tells the bus each channel\'s numeric id', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', line('room-id=99', ':tmi.twitch.tv ROOMSTATE #pixelwitch'))
    ws.emit('message', chat('1', 'hi'))
    expect(out.ready).toEqual([['pixelwitch', '99'], ['pixelwitch', '99']])
    adapter.disconnect()
  })

  it('shows channel events', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', line('msg-id=raid;login=raider;system-msg=5\\sraiders\\sfrom\\sraider;id=e1;room-id=99', ':tmi.twitch.tv USERNOTICE #pixelwitch'))
    expect(out.messages[0].event).toMatchObject({ type: 'raid', title: '5 raiders from raider' })
    adapter.disconnect()
  })

  it('shows a gift bomb once: the summary, not each of its single gifts', async () => {
    const { adapter, out, ws } = await connected()
    const gift = (kind: string, origin: string, id: string) => line(`msg-id=${kind};msg-param-origin-id=${origin};login=g;system-msg=gift;id=${id};room-id=99`, ':tmi.twitch.tv USERNOTICE #pixelwitch')
    ws.emit('message', gift('submysterygift', 'O1', 's'))
    ws.emit('message', gift('subgift', 'O1', 'g1') + gift('subgift', 'O1', 'g2'))
    ws.emit('message', gift('subgift', 'O2', 'solo')) // a different, ordinary gift
    expect(out.messages.map((m) => m.id)).toEqual(['s', 'solo'])
    adapter.disconnect()
  })

  it('passes on deleted messages', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', line('login=viewer;target-msg-id=M1', ':tmi.twitch.tv CLEARMSG #pixelwitch :oops'))
    expect(out.moderation).toEqual([{ type: 'delete-message', platform: 'twitch', channelId: 'pixelwitch', messageId: 'M1' }])
    adapter.disconnect()
  })

  it('marks a banned user\'s messages BEFORE adding the note row', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', line('ban-duration=60;target-user-id=7', ':tmi.twitch.tv CLEARCHAT #pixelwitch :viewer'))
    expect(out.order).toEqual(['moderation', 'message'])
    expect(out.moderation[0]).toMatchObject({ type: 'clear-user', login: 'viewer', durationSec: 60 })
    adapter.disconnect()
  })

  it('ignores lines it does not understand', async () => {
    const { adapter, out, ws } = await connected()
    ws.emit('message', ':tmi.twitch.tv 372 x :motd\r\n\r\ngarbage\r\n')
    expect(out.messages).toHaveLength(0)
    adapter.disconnect()
  })
})

describe('changing channels', () => {
  it('joins and leaves right away once welcomed', async () => {
    const { adapter, out, ws } = await connected(['a', 'b'])
    adapter.setChannels(['b', 'c'])
    expect(ws.sent.slice(-2)).toEqual(['JOIN #c', 'PART #a'])
    expect(out.statuses.at(-1)).toMatchObject({ detail: '#b #c' })
    adapter.disconnect()
  })

  it('sends nothing for unchanged channels', async () => {
    const { adapter, ws } = await connected(['a'])
    const before = ws.sent.length
    adapter.setChannels(['a'])
    expect(ws.sent.length).toBe(before)
    adapter.disconnect()
  })

  it('waits for the welcome when the list changes earlier', async () => {
    const { adapter } = make(['a'])
    await adapter.connect()
    const ws = sockets()[0]
    ws.emit('open')
    adapter.setChannels(['x', 'y'])
    expect(ws.sent.some((s) => s.startsWith('JOIN'))).toBe(false)
    ws.emit('message', ':tmi.twitch.tv 001 j :Welcome\r\n')
    expect(ws.sent.at(-1)).toBe('JOIN #x,#y')
    adapter.disconnect()
  })
})

describe('dropped connections', () => {
  it('reconnects after a drop, re-joins its channels and says so', async () => {
    const restore = fastTimers(100)
    try {
      const { adapter, out, ws } = await connected(['a'])
      ws.emit('close', 1006)
      expect(out.statuses.at(-1)).toMatchObject({ state: 'connecting' })
      expect(String(out.statuses.at(-1)?.detail)).toMatch(/^reconnecting in \d+s$/)
      await sleep(80)
      expect(sockets()).toHaveLength(2)
      const next = sockets()[1]
      next.emit('open')
      next.emit('message', ':tmi.twitch.tv 001 j :Welcome\r\n')
      expect(next.sent.at(-1)).toBe('JOIN #a') // joins do not survive a reconnect, so they are redone
      adapter.disconnect()
    } finally {
      restore()
    }
  })

  it('backs off longer after repeated failures, and starts over after a good connection', async () => {
    const restore = fastTimers(100)
    try {
      const { adapter, out } = make()
      await adapter.connect()
      const delays: number[] = []
      for (let i = 0; i < 3; i++) {
        sockets().at(-1)!.emit('close', 1006) // never welcomed
        delays.push(Number(/in (\d+)s/.exec(String(out.statuses.at(-1)?.detail))?.[1]))
        await sleep(120) // real time; the fast reconnect timer fires well within this
      }
      expect(delays[0]).toBeLessThanOrEqual(2) // 1 s (+ jitter)
      expect(delays[2]).toBeGreaterThan(delays[0]) // 4 s
      const ws = sockets().at(-1)!
      ws.emit('open')
      ws.emit('message', ':tmi.twitch.tv 001 j :Welcome\r\n')
      ws.emit('close', 1006)
      expect(Number(/in (\d+)s/.exec(String(out.statuses.at(-1)?.detail))?.[1])).toBeLessThanOrEqual(2)
      adapter.disconnect()
    } finally {
      restore()
    }
  })

  it('closes the socket when Twitch says it is about to restart', async () => {
    const { adapter, ws } = await connected()
    ws.emit('message', ':tmi.twitch.tv RECONNECT\r\n')
    expect(ws.closed).toBe(true)
    adapter.disconnect()
  })
})

describe('disconnect', () => {
  it('closes, reports disconnected, and does not reconnect', async () => {
    const restore = fastTimers(100)
    try {
      const { adapter, out, ws } = await connected()
      adapter.disconnect()
      expect(ws.closed).toBe(true)
      expect(out.statuses.at(-1)).toEqual({ state: 'disconnected' })
      ws.emit('close', 1000) // listeners were removed, so this must not start a reconnect
      await sleep(80)
      expect(sockets()).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it('can connect again afterwards', async () => {
    const { adapter } = await connected()
    adapter.disconnect()
    await adapter.connect()
    expect(sockets()).toHaveLength(2)
    adapter.disconnect()
  })
})
