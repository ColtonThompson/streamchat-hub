/**
 * main/twitch/helix.ts
 *
 * WHAT: A small client for "Helix", Twitch's official web API. Everything that talks to
 *       api.twitch.tv goes through here: badge images, sending chat, and moderation.
 *
 * HOW IT FITS: The MessageBus owns one Helix. It asks TwitchAuth for a valid token for every call, so
 *       callers never deal with tokens. Methods return an `ActionResult` ({ok, error}) whose
 *       `error` text is written for the user to read and is shown directly in the UI.
 *
 * CHANGE IT WHEN: you want another Twitch API call. Copy `deleteMessage` below as a template;
 *       the Twitch API reference (dev.twitch.tv/docs/api/reference) lists each endpoint's URL,
 *       parameters and required permission ("scope"). If it needs a new scope, add it in auth.ts.
 */
import type { ActionResult } from '../../shared/types'
import type { TwitchAuth } from './auth'

/** One badge family from /chat/badges, e.g. all "subscriber" badge versions. */
export interface BadgeSet {
  set_id: string
  versions: { id: string; image_url_2x: string; title?: string }[]
}

/** One live channel from /streams/followed. */
export interface LiveStream {
  userId: string
  login: string
  name: string
  /** Category being streamed ("" when none is set). */
  game: string
  title: string
  viewers: number
  /** False for the rare non-"live" entries (e.g. a rerun): they are not announced. */
  live: boolean
}

/** A failed Helix call; `status` lets callers react to 401/403 differently from a network blip. */
export class HelixError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const API = 'https://api.twitch.tv/helix'

export class Helix {
  constructor(private auth: TwitchAuth) {}

  /**
   * Make an authenticated request. Returns undefined when nobody is signed in.
   * If Twitch answers 401 (token expired early), refreshes the token and retries once.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.auth.getAccessToken()
      if (!token) return undefined
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Client-Id': this.auth.clientId, // Twitch requires both the token and our app's id
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10_000)
      })
      if (res.status !== 401 || attempt === 1 || !(await this.auth.refresh())) return res
    }
    return undefined
  }

  /**
   * Turn a failed response into a sentence for the user. Twitch usually explains the problem in the
   * body's `message` field (e.g. "user is already banned"); we add context for the common cases.
   */
  private async describeFailure(res: Response): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json().catch(() => ({}))
    const detail: string | undefined = body.message
    switch (res.status) {
      case 401:
        return 'Your Twitch login has expired. Sign in again.'
      case 403:
        return `Twitch refused this${detail ? ` (${detail})` : ''}. You must be the channel's broadcaster or moderator, and have enabled moderation tools.`
      case 429:
        return 'Twitch is limiting how fast you can do that. Wait a moment and try again.'
      default:
        return detail ?? `Twitch returned ${res.status}`
    }
  }

  /** Convert a response to an ActionResult for calls that return nothing useful on success. */
  private async toResult(res: Response | undefined): Promise<ActionResult> {
    if (!res) return { ok: false, error: 'Sign in to Twitch first.' }
    return res.ok ? { ok: true } : { ok: false, error: await this.describeFailure(res) }
  }

  // ------------------------------------------------------------------------------- badges

  /**
   * Badge images. Pass a broadcaster id for that channel's custom badges (e.g. sub-tier badges),
   * or nothing for the global ones. Returns undefined when signed out.
   */
  async getBadges(broadcasterId?: string): Promise<BadgeSet[] | undefined> {
    const path = broadcasterId ? `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}` : '/chat/badges/global'
    const res = await this.request(path)
    if (!res) return undefined
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
    return ((await res.json()) as { data?: BadgeSet[] }).data ?? []
  }

  // ---------------------------------------------------------------------------------- chat

  /** Send a chat message as the signed-in user. Needs scope `user:write:chat`. */
  async sendChat(broadcasterId: string, senderId: string, message: string): Promise<ActionResult> {
    const res = await this.request('/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: senderId, message })
    })
    if (!res) return { ok: false, error: 'Sign in to Twitch to send messages.' }
    if (!res.ok) return { ok: false, error: await this.describeFailure(res) }
    // Twitch can answer 200 yet still drop the message (slow mode, banned word...). Check the body.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json().catch(() => ({}))
    const item = body.data?.[0]
    if (item && item.is_sent === false) {
      return { ok: false, error: item.drop_reason?.message ?? 'Twitch did not accept that message.' }
    }
    return { ok: true }
  }

  // ------------------------------------------------------------------------- followed streams

  /**
   * The channels the user follows that are live right now (with game and title). Needs scope
   * `user:read:follows`. One call replaces watching every followed channel individually. Twitch
   * returns up to 100 per page; we read at most 3 pages. Returns undefined when signed out and
   * throws a HelixError on an HTTP error so the caller can tell "nobody is live" from "the lookup failed".
   */
  async getFollowedStreams(userId: string): Promise<LiveStream[] | undefined> {
    const out: LiveStream[] = []
    let cursor = ''
    for (let page = 0; page < 3; page++) {
      const res = await this.request(`/streams/followed?user_id=${encodeURIComponent(userId)}&first=100${cursor}`)
      if (!res) return undefined
      if (!res.ok) throw new HelixError(res.status, await this.describeFailure(res))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = await res.json().catch(() => ({}))
      const data: any[] = body.data ?? []
      for (const s of data) {
        if (!s?.user_id || !s.user_login) continue
        out.push({
          userId: String(s.user_id),
          login: String(s.user_login),
          name: String(s.user_name || s.user_login),
          game: String(s.game_name ?? ''),
          title: String(s.title ?? ''),
          viewers: Number(s.viewer_count) || 0,
          live: s.type === 'live'
        })
      }
      const next = body.pagination?.cursor
      if (!next || data.length < 100) break
      cursor = `&after=${encodeURIComponent(next)}`
    }
    return out
  }

  // --------------------------------------------------------------------------- EventSub

  /**
   * Ask Twitch to push one kind of event (e.g. "channel.poll.begin") to an open EventSub WebSocket
   * session. Needs the token's scopes to cover that event, and for these event types the token's user
   * must BE the broadcaster. Twitch answers 202 when accepted.
   */
  async subscribeEventSub(type: string, broadcasterId: string, sessionId: string): Promise<ActionResult> {
    const res = await this.request('/eventsub/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        type,
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: 'websocket', session_id: sessionId }
      })
    })
    if (!res) return { ok: false, error: 'Sign in to Twitch first.' }
    if (res.ok) return { ok: true }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json().catch(() => ({}))
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Twitch refused: enable polls & predictions in Settings → Accounts, and use your own channel.' }
    }
    return { ok: false, error: body.message ?? `Twitch returned ${res.status}` }
  }

  // ------------------------------------------------------------------------- moderation
  // All three need `moderatorId` = the signed-in user's id, and that user must be the channel's
  // broadcaster or one of its moderators. After a successful call Twitch announces the result on
  // the chat connection (CLEARMSG / CLEARCHAT), which is what updates the screen.

  /** Delete one message. Needs scope `moderator:manage:chat_messages`. */
  async deleteMessage(broadcasterId: string, moderatorId: string, messageId: string): Promise<ActionResult> {
    const q = new URLSearchParams({ broadcaster_id: broadcasterId, moderator_id: moderatorId, message_id: messageId })
    return this.toResult(await this.request(`/moderation/chat?${q}`, { method: 'DELETE' }))
  }

  /**
   * Time out (pass `durationSec`, 1 to 1,209,600) or permanently ban (omit it) a user.
   * Needs scope `moderator:manage:banned_users`.
   */
  async ban(broadcasterId: string, moderatorId: string, userId: string, durationSec?: number): Promise<ActionResult> {
    const q = new URLSearchParams({ broadcaster_id: broadcasterId, moderator_id: moderatorId })
    const data: Record<string, unknown> = { user_id: userId }
    if (durationSec) data.duration = durationSec
    return this.toResult(await this.request(`/moderation/bans?${q}`, { method: 'POST', body: JSON.stringify({ data }) }))
  }

  /** Lift a ban OR end a timeout early. Needs scope `moderator:manage:banned_users`. */
  async unban(broadcasterId: string, moderatorId: string, userId: string): Promise<ActionResult> {
    const q = new URLSearchParams({ broadcaster_id: broadcasterId, moderator_id: moderatorId, user_id: userId })
    return this.toResult(await this.request(`/moderation/bans?${q}`, { method: 'DELETE' }))
  }
}
