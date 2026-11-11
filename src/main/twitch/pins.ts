/**
 * main/twitch/pins.ts   (Twitch pinned chat messages)
 *
 * WHAT: Finds out which message a Twitch channel has pinned, so the UI can show it in a bar above the chat.
 *
 * WHY POLLING: Twitch has an API to READ the pinned message (`GET /chat/pins`) but no push event for it, so
 *   `PinWatcher` asks every 20 seconds for each channel being read. It only reports CHANGES (a new pin, a
 *   changed expiry, or the pin going away).
 *
 * WHO CAN SEE IT: the call needs you to be the broadcaster or a moderator of that channel (and the moderation
 *   permission). In other channels Twitch answers 401/403; those channels are skipped for 10 minutes, quietly.
 *
 * `parseTwitchPin` and `PinWatcher` do no network or Electron work themselves (the caller injects `fetchPin`),
 * so both are easy to test.
 */
import type { MessagePart, PinnedMessage } from '../../shared/types'
import { HelixError } from './helix'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** `data[0]` of `GET /chat/pins` -> a PinnedMessage (or undefined when it is unusable). */
export function parseTwitchPin(login: string, data: unknown): PinnedMessage | undefined {
  const d = rec(data)
  const messageId = str(d?.message_id)
  const message = rec(d?.message)
  if (!d || !messageId || !message) return undefined

  const parts: MessagePart[] = []
  const fragments = Array.isArray(message.fragments) ? message.fragments : []
  for (const f of fragments) {
    const frag = rec(f)
    const text = typeof frag?.text === 'string' ? frag.text : ''
    const emoteId = str(rec(frag?.emote)?.id)
    if (frag?.type === 'emote' && emoteId) {
      parts.push({ type: 'emote', value: text, url: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/default/dark/2.0`, source: 'native' })
    } else if (text) {
      parts.push({ type: 'text', value: text })
    }
  }
  if (!parts.length) {
    const plain = str(message.text)
    if (plain) parts.push({ type: 'text', value: plain })
  }
  if (!parts.length) return undefined

  const ends = typeof d.ends_at === 'string' ? Date.parse(d.ends_at) : NaN
  return {
    platform: 'twitch',
    channelId: login.toLowerCase(),
    messageId,
    author: { name: str(d.sender_user_name) ?? str(d.sender_user_login) ?? 'Someone' },
    pinnedBy: str(d.pinned_by_user_name) ?? str(d.pinned_by_user_login),
    parts,
    ...(Number.isFinite(ends) ? { endsAt: ends } : {})
  }
}

export interface PinTarget {
  login: string
  /** The channel's numeric Twitch id. */
  id: string
}

export interface PinWatcherOptions {
  /** The channels to check right now (ones whose numeric id is known). Asked on every poll. */
  targets: () => PinTarget[]
  /** The channel's current pin; `null` = nothing pinned; `undefined` = couldn't tell (leave things as they are). */
  fetchPin: (target: PinTarget) => Promise<PinnedMessage | null | undefined>
  onPin: (pin: PinnedMessage) => void
  onUnpin: (login: string) => void
  intervalMs?: number
  /** How long to leave a channel alone after Twitch says we may not see its pin. */
  skipMs?: number
  now?: () => number
}

export class PinWatcher {
  private timer?: ReturnType<typeof setInterval>
  private polling = false
  /** login -> "messageId|endsAt" of the pin currently shown. */
  private shown = new Map<string, string>()
  /** login -> time (ms) before which we don't ask again. */
  private skipUntil = new Map<string, number>()

  constructor(private opts: PinWatcherOptions) {}

  get active(): boolean {
    return this.timer !== undefined
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 20_000)
    void this.poll()
  }

  /** Stop, and take down every pin that is showing. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const login of [...this.shown.keys()]) this.opts.onUnpin(login)
    this.shown.clear()
    this.skipUntil.clear()
  }

  /** One round of checks. Safe to call at any time; overlapping calls are ignored. */
  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const now = (this.opts.now ?? Date.now)()
      const targets = this.opts.targets()
      const logins = new Set(targets.map((t) => t.login))
      for (const login of [...this.shown.keys()]) {
        if (!logins.has(login)) this.clear(login) // the channel was removed from the list
      }
      for (const target of targets) {
        if ((this.skipUntil.get(target.login) ?? 0) > now) continue
        let pin: PinnedMessage | null | undefined
        try {
          pin = await this.opts.fetchPin(target)
        } catch (err) {
          if (err instanceof HelixError && (err.status === 401 || err.status === 403)) {
            this.skipUntil.set(target.login, now + (this.opts.skipMs ?? 600_000)) // not a mod there
            this.clear(target.login)
          }
          continue // any other problem: try again next round
        }
        if (pin === undefined) continue
        if (pin === null) {
          this.clear(target.login)
          continue
        }
        const key = `${pin.messageId}|${pin.endsAt ?? ''}`
        if (this.shown.get(target.login) === key) continue
        this.shown.set(target.login, key)
        this.opts.onPin(pin)
      }
    } finally {
      this.polling = false
    }
  }

  private clear(login: string): void {
    if (this.shown.delete(login)) this.opts.onUnpin(login)
  }
}
