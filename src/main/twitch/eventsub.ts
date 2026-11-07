/**
 * main/twitch/eventsub.ts   (Twitch "EventSub" over a WebSocket)
 *
 * WHAT: Receives things chat itself doesn't carry: here, polls and predictions. Chat (IRC) only has
 *       messages; Twitch pushes poll/prediction updates through a separate service called EventSub.
 *
 * HOW IT WORKS:
 *   1. Open a WebSocket to wss://eventsub.wss.twitch.tv/ws.
 *   2. Twitch sends `session_welcome` with a session id. WITHIN 10 SECONDS we must ask for each kind of
 *      event we want ("subscribe"), using the signed-in user's token and that session id. (Twitch closes
 *      the socket with code 4003 if we are late.) The subscribing itself is done by the `subscribe`
 *      function we are given (Helix.subscribeEventSub), so this file holds no tokens.
 *   3. Then Twitch sends `notification` messages (the events) and a `session_keepalive` every ~10 s.
 *
 * WHAT CAN GO WRONG (and what we do):
 *   - Connection drops, or no message at all for longer than the keepalive time -> reconnect from
 *     scratch (1 s, 2 s, 4 s ... up to 30 s) and subscribe again. Events during the gap are lost.
 *   - Twitch asks us to move servers (`session_reconnect`) -> open the new URL, and only once ITS welcome
 *     arrives close the old socket. Subscriptions carry over, so nothing is re-subscribed.
 *   - Every subscription is refused (e.g. permission missing, or not the user's own channel) -> report
 *     the reason and retry slowly (up to every 5 minutes); no point hammering Twitch.
 *   - Twitch revokes the subscriptions (permission removed) -> report it and stop.
 *   - Twitch can deliver the same notification twice -> remembered ids drop the repeat.
 *
 * WHY THE SOCKET IS INJECTED (`createSocket`): so the tests can run this against a fake Twitch.
 *
 * HOW IT FITS: MessageBus creates one when you are signed in with the polls permission, Twitch is on,
 *   and your own channel is in the Twitch box (bus.ts `syncActivity`). It forwards events to
 *   twitch/activity.ts for parsing.
 */
import type { ActionResult } from '../../shared/types'

const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws'

/** The small part of a WebSocket we use (the `ws` package's WebSocket fits it). */
export interface SocketLike {
  on(event: 'message', cb: (data: { toString(): string }) => void): unknown
  on(event: 'close', cb: (code: number) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  close(): void
  terminate?(): void
  removeAllListeners?(): unknown
}

export type EventSubState =
  | { state: 'connecting' }
  | { state: 'connected' }
  /** Something is wrong; `message` is written for the user. `retrying` says whether we will try again by ourselves. */
  | { state: 'error'; message: string; retrying: boolean }

export interface EventSubOptions {
  /** Event names to subscribe to, e.g. ['channel.poll.begin', ...]. */
  types: readonly string[]
  createSocket: (url: string) => SocketLike
  /** Ask Twitch for one event type on this session. */
  subscribe: (type: string, sessionId: string) => Promise<ActionResult>
  /** One event arrived. `event` is Twitch's payload, unparsed. */
  onNotification: (type: string, event: unknown) => void
  onState: (state: EventSubState) => void
  url?: string
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : undefined)

export class EventSubClient {
  private socket?: SocketLike
  /** A socket opened because Twitch asked us to move (`session_reconnect`); it replaces `socket` once welcomed. */
  private pending?: SocketLike
  private stopped = true
  /** Consecutive failures; drives the retry delay. Reset by a successful subscribe. */
  private attempt = 0
  private keepaliveTimer?: NodeJS.Timeout
  private retryTimer?: NodeJS.Timeout
  /** Keepalive limit from the last welcome, in ms (already includes some slack). */
  private keepaliveMs = 15_000
  /** Recent notification ids, to drop duplicates. */
  private seen: string[] = []

  constructor(private opts: EventSubOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.open(this.opts.url ?? DEFAULT_URL)
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.keepaliveTimer)
    clearTimeout(this.retryTimer)
    this.drop(this.socket)
    this.drop(this.pending)
    this.socket = this.pending = undefined
  }

  // ------------------------------------------------------------------------------ connecting

  /** Open a socket. `url` is Twitch's normal address, or the `reconnect_url` it gave us. */
  private open(url: string): void {
    const reconnecting = url !== (this.opts.url ?? DEFAULT_URL)
    if (!reconnecting) this.opts.onState({ state: 'connecting' })
    const socket = this.opts.createSocket(url)
    if (reconnecting) this.pending = socket
    else this.socket = socket

    socket.on('message', (data) => this.onMessage(socket, data.toString()))
    socket.on('error', () => {
      /* a 'close' always follows; handled there */
    })
    socket.on('close', () => this.onClose(socket))
  }

  /** Detach and close a socket without triggering our reconnect logic. */
  private drop(socket: SocketLike | undefined): void {
    if (!socket) return
    socket.removeAllListeners?.()
    socket.on('error', () => {}) // a closing socket can still emit an error; an unhandled one would crash the app
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }

  private onClose(socket: SocketLike): void {
    if (this.stopped) return
    if (socket === this.pending) {
      this.pending = undefined // the move failed; the old socket is still ours until Twitch closes it
      return
    }
    if (socket !== this.socket) return // an old socket we already replaced
    clearTimeout(this.keepaliveTimer)
    this.socket = undefined
    this.scheduleReconnect(30_000)
  }

  /** Wait 1 s, 2 s, 4 s ... (at most `maxMs`, plus a little randomness) and start over. */
  private scheduleReconnect(maxMs: number, error?: string): void {
    const delay = Math.min(maxMs, 1000 * 2 ** this.attempt) + Math.random() * 500
    this.attempt++
    if (error) this.opts.onState({ state: 'error', message: error, retrying: true })
    else this.opts.onState({ state: 'connecting' })
    this.retryTimer = setTimeout(() => {
      if (!this.stopped) this.open(this.opts.url ?? DEFAULT_URL)
    }, delay)
  }

  /** (Re)start the "has anything arrived lately?" countdown for the current socket. */
  private armKeepalive(): void {
    clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      // Silence for too long: the connection is dead. Closing it triggers the reconnect.
      const s = this.socket
      if (s) (s.terminate ?? s.close).call(s)
    }, this.keepaliveMs)
  }

  // ------------------------------------------------------------------------------- messages

  private onMessage(socket: SocketLike, raw: string): void {
    if (this.stopped || (socket !== this.socket && socket !== this.pending)) return
    let msg: Rec | undefined
    try {
      msg = rec(JSON.parse(raw))
    } catch {
      return
    }
    const meta = rec(msg?.metadata)
    const payload = rec(msg?.payload)
    const kind = meta?.message_type

    // Any message from the current socket proves it is alive.
    if (socket === this.socket) this.armKeepalive()

    switch (kind) {
      case 'session_welcome': {
        const session = rec(payload?.session)
        const id = typeof session?.id === 'string' ? session.id : undefined
        if (!id) return
        const seconds = typeof session?.keepalive_timeout_seconds === 'number' ? session.keepalive_timeout_seconds : 10
        if (socket === this.pending) {
          // The move finished: the new socket takes over; subscriptions came with it.
          const old = this.socket
          this.socket = socket
          this.pending = undefined
          this.keepaliveMs = seconds * 1000 + 3000
          this.armKeepalive()
          this.drop(old)
          return
        }
        this.keepaliveMs = seconds * 1000 + 3000
        this.armKeepalive()
        void this.subscribeAll(socket, id)
        return
      }

      case 'session_reconnect': {
        const url = rec(payload?.session)?.reconnect_url
        if (socket === this.socket && typeof url === 'string' && !this.pending) this.open(url)
        return
      }

      case 'notification': {
        const id = typeof meta?.message_id === 'string' ? meta.message_id : undefined
        if (id) {
          if (this.seen.includes(id)) return // a repeat of one we already handled
          this.seen.push(id)
          if (this.seen.length > 100) this.seen.shift()
        }
        const type = typeof meta?.subscription_type === 'string' ? meta.subscription_type : str(rec(payload?.subscription)?.type)
        if (type) this.opts.onNotification(type, payload?.event)
        return
      }

      case 'revocation': {
        const why = str(rec(payload?.subscription)?.status) ?? 'revoked'
        this.stop()
        this.opts.onState({
          state: 'error',
          message: `Twitch stopped sending polls & predictions (${why.replace(/_/g, ' ')}). Enable them again in Settings → Accounts.`,
          retrying: false
        })
        return
      }
      // 'session_keepalive' needs nothing beyond the timer reset above.
    }
  }

  /** After the welcome: ask for every event type. Succeeds if at least one is accepted. */
  private async subscribeAll(socket: SocketLike, sessionId: string): Promise<void> {
    const results = await Promise.all(this.opts.types.map((t) => this.opts.subscribe(t, sessionId).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as ActionResult)))
    if (this.stopped || socket !== this.socket) return // stopped, or replaced while we were asking
    if (results.some((r) => r.ok)) {
      this.attempt = 0
      this.opts.onState({ state: 'connected' })
      return
    }
    // Nothing was accepted. Most likely a permission problem, which retrying won't fix soon: back off up to 5 minutes.
    const reason = results.find((r) => r.error)?.error ?? 'Twitch refused the request.'
    this.drop(socket)
    this.socket = undefined
    clearTimeout(this.keepaliveTimer)
    this.scheduleReconnect(300_000, reason)
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
