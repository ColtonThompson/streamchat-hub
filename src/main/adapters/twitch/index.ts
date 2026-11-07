/**
 * main/adapters/twitch/index.ts   (the Twitch adapter)
 *
 * WHAT: Connects to Twitch chat and turns what arrives into app messages.
 *
 * HOW IT WORKS: Twitch chat is an IRC server reachable over a WebSocket (a long-lived two-way
 *   connection). We log in as an anonymous user (a name starting with "justinfan"), which Twitch
 *   allows for READ-ONLY access to any public channel, so no sign-in is needed to read chat. Sending
 *   messages and moderating use Twitch's web API instead (twitch/helix.ts), not this connection.
 *
 *   Lifecycle:  open WebSocket -> send CAP/PASS/NICK -> Twitch says "001" (welcome)
 *               -> we JOIN the channels -> lines stream in -> `handle()` routes each by command.
 *
 * RELIABILITY (this class's main job besides parsing):
 *   - Replies to Twitch's PING keepalives, otherwise it disconnects us.
 *   - If the connection closes unexpectedly, reconnects with growing delays (1s, 2s, 4s ... max 30s).
 *   - If nothing at all arrives for 6 minutes, assumes the connection silently died and restarts it.
 *   - Obeys Twitch's RECONNECT command (they restart servers occasionally).
 *
 * HOW IT FITS: created by adapters/index.ts; reports through the `AdapterEmit` it is given
 *   (adapters/base.ts). All Twitch-specific parsing is in parse.ts; this file is the plumbing.
 *
 * CHANGE IT WHEN: you want to handle another Twitch command (add a `case` in `handle()`), or change
 *   reconnect behaviour.
 */
import WebSocket from 'ws'
import type { AdapterEmit, ChatAdapter } from '../base'
import { GiftBombFilter } from './gifts'
import { parseIrc } from './irc'
import { clearmsgToAction, parseClearChat, privmsgToChatMessage, usernoticeToChatMessage } from './parse'

const URL = 'wss://irc-ws.chat.twitch.tv:443'
/** Twitch pings about every 5 minutes; silence for longer than this means the socket is dead. */
const STALE_MS = 6 * 60_000

export class TwitchAdapter implements ChatAdapter {
  readonly platform = 'twitch' as const

  private ws?: WebSocket
  /** Channels we WANT to be in (what the user typed). */
  private wanted: Set<string>
  /** Channels we have actually JOINed on the current connection. `wanted` vs `joined` is diffed in syncJoins(). */
  private joined = new Set<string>()
  /** True once Twitch has welcomed us (001); we may only JOIN after that. */
  private ready = false
  private giftBombs = new GiftBombFilter()
  /** True after disconnect(): tells the 'close' handler NOT to reconnect. */
  private stopped = true
  /** Consecutive failed connection attempts; drives the backoff delay. Reset when welcomed. */
  private attempt = 0
  private retryTimer?: NodeJS.Timeout
  private staleTimer?: NodeJS.Timeout

  constructor(
    private emit: AdapterEmit,
    channels: string[]
  ) {
    this.wanted = new Set(channels)
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.open()
  }

  disconnect(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.staleTimer)
    this.ws?.removeAllListeners() // so closing doesn't trigger our reconnect logic
    this.ws?.close()
    this.ws = undefined
    this.ready = false
    this.joined.clear()
    this.emit.status({ state: 'disconnected' })
  }

  /** The user edited the channel list. If already welcomed, join/leave right away; else it happens on welcome. */
  setChannels(channels: string[]): void {
    this.wanted = new Set(channels)
    if (!this.ready) return
    this.syncJoins()
    this.reportConnected()
  }

  // ===================================================================== connection handling

  private open(): void {
    this.emit.status({ state: 'connecting', detail: this.attempt > 0 ? 'reconnecting' : undefined })
    const ws = new WebSocket(URL)
    this.ws = ws

    ws.on('open', () => {
      // CAP REQ asks for IRC extensions: "tags" gives us badges/colour/emotes, "commands" gives us
      // USERNOTICE, CLEARCHAT, ROOMSTATE etc. Without these chat would be plain text.
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send('PASS SCHMOOCHIES') // any password works for anonymous logins
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`) // "justinfan<digits>" = anonymous read-only
      this.armStaleTimer()
    })

    ws.on('message', (data) => {
      this.armStaleTimer()
      // One WebSocket message can hold several IRC lines separated by CRLF.
      for (const line of data.toString().split('\r\n')) if (line) this.handle(line)
    })

    ws.on('error', (err) => this.emit.status({ state: 'error', detail: err.message }))

    ws.on('close', () => {
      if (this.ws !== ws) return // an old socket we already replaced
      clearTimeout(this.staleTimer)
      this.ready = false
      this.joined.clear() // joins don't survive a reconnect; syncJoins() redoes them
      this.ws = undefined
      if (!this.stopped) this.scheduleReconnect()
    })
  }

  /** Wait 1s, 2s, 4s ... up to 30s (plus a little randomness) before trying again. */
  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt) + Math.random() * 500
    this.attempt++
    this.emit.status({ state: 'connecting', detail: `reconnecting in ${Math.round(delay / 1000)}s` })
    this.retryTimer = setTimeout(() => this.open(), delay)
  }

  /** (Re)start the "has anything arrived lately?" countdown. If it ever fires, kill the socket; 'close' then reconnects. */
  private armStaleTimer(): void {
    clearTimeout(this.staleTimer)
    this.staleTimer = setTimeout(() => this.ws?.terminate(), STALE_MS)
  }

  // ====================================================================== protocol handling

  /** Route one incoming line by its command. */
  private handle(line: string): void {
    const irc = parseIrc(line)
    if (!irc) return

    switch (irc.command) {
      case 'PING': // Twitch's keepalive: answer or get disconnected
        this.ws?.send(`PONG :${irc.trailing ?? 'tmi.twitch.tv'}`)
        break

      case '001': // "welcome": the login worked and we may now JOIN channels
        this.ready = true
        this.attempt = 0 // a good connection resets the backoff
        this.syncJoins()
        this.reportConnected()
        break

      case 'ROOMSTATE': // sent right after JOIN; its `room-id` tag is the channel's numeric id
        this.announceChannel(irc.params[0], irc.tags['room-id'])
        break

      case 'PRIVMSG': { // an ordinary chat message
        this.announceChannel(irc.params[0], irc.tags['room-id']) // backup in case ROOMSTATE was missed
        const msg = privmsgToChatMessage(irc)
        if (msg) this.emit.message(msg)
        break
      }

      case 'USERNOTICE': { // sub, gift, raid, announcement...
        this.announceChannel(irc.params[0], irc.tags['room-id'])
        const kind = irc.tags['msg-id']
        const origin = irc.tags['msg-param-origin-id']
        if (kind === 'submysterygift' && origin) this.giftBombs.note(origin) // remember the summary...
        if (kind === 'subgift' && this.giftBombs.isPartOfBomb(origin)) break // ...and skip its individual notices
        const evt = usernoticeToChatMessage(irc)
        if (evt) this.emit.message(evt)
        break
      }

      case 'CLEARMSG': { // one message was deleted
        const action = clearmsgToAction(irc)
        if (action) this.emit.moderation?.(action)
        break
      }

      case 'CLEARCHAT': { // a timeout, ban, or "chat cleared"
        const result = parseClearChat(irc)
        if (!result) break
        // Order matters: first mark the user's existing messages as removed, then add the note row.
        if (result.action) this.emit.moderation?.(result.action)
        this.emit.message(result.notice)
        break
      }

      case 'RECONNECT': // Twitch is restarting this server: close and let the normal reconnect logic reopen
        this.ws?.close()
        break

      case 'NOTICE': // server messages; we only care about a failed login
        if (irc.trailing?.includes('Login unsuccessful')) this.emit.status({ state: 'error', detail: irc.trailing })
        break
    }
  }

  /** Tell the bus a channel's numeric id so it can load emotes/badges and target moderation. */
  private announceChannel(param: string | undefined, roomId: string | undefined): void {
    const channel = param?.replace(/^#/, '')
    if (channel && roomId) this.emit.channelReady?.(channel, roomId)
  }

  /** Make the set of joined channels match the set we want: JOIN the new ones, PART the removed ones. */
  private syncJoins(): void {
    const toJoin = [...this.wanted].filter((c) => !this.joined.has(c))
    const toPart = [...this.joined].filter((c) => !this.wanted.has(c))
    if (toJoin.length) this.ws?.send(`JOIN ${toJoin.map((c) => '#' + c).join(',')}`)
    if (toPart.length) this.ws?.send(`PART ${toPart.map((c) => '#' + c).join(',')}`)
    toJoin.forEach((c) => this.joined.add(c))
    toPart.forEach((c) => this.joined.delete(c))
  }

  /** Update the top-bar chip: connected, with the channel list as its tooltip. */
  private reportConnected(): void {
    const detail = this.wanted.size ? [...this.wanted].map((c) => '#' + c).join(' ') : 'add a channel to start reading'
    this.emit.status({ state: 'connected', detail })
  }
}
