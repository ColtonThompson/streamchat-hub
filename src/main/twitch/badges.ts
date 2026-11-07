/**
 * main/twitch/badges.ts   (BadgeService)
 *
 * WHAT: Replaces text badges ("MOD") with Twitch's real badge images.
 *
 * WHY IT'S SEPARATE FROM PARSING: Twitch chat lines only say WHICH badges a user has
 *   ("subscriber/12"), not what they look like. The images come from a different Twitch API
 *   (Helix) that needs a signed-in user. Channels also have custom badges (e.g. sub-tier badges).
 *
 * HOW IT WORKS: Same pattern as EmoteService.
 *   - `reload()` downloads global badges plus those of every known channel. Called at startup if
 *     signed in, and again right after the user signs in.
 *   - `registerChannel()` downloads one channel's badges when the channel's id becomes known.
 *   - `process(message)` looks up each badge id ("subscriber/12") in the channel's set first, then
 *     the global set, and attaches `url` and `title`.
 *   While signed out, nothing loads, and messages simply keep their text badges.
 *
 * HOW IT FITS: owned by MessageBus. It only needs `getBadges`, so tests can pass a fake.
 */
import type { Badge, ChatMessage } from '../../shared/types'
import type { BadgeSet, Helix } from './helix'

/** "set/version" -> image. */
type BadgeMap = Map<string, { url: string; title?: string }>

const READY_TIMEOUT_MS = 3000

/** Flatten Twitch's nested badge sets into one lookup table keyed "set_id/version_id". */
function toMap(sets: BadgeSet[] | undefined): BadgeMap {
  const map: BadgeMap = new Map()
  for (const set of sets ?? []) {
    for (const v of set.versions) map.set(`${set.set_id}/${v.id}`, { url: v.image_url_2x, title: v.title })
  }
  return map
}

interface ChannelEntry {
  broadcasterId: string
  map: BadgeMap
  ready: Promise<void>
}

export class BadgeService {
  private globalMap: BadgeMap = new Map()
  private globalReady: Promise<void> = Promise.resolve()
  private channels = new Map<string, ChannelEntry>()

  constructor(private helix: Pick<Helix, 'getBadges'>) {}

  /** (Re)download everything. Call at startup and after signing in. */
  reload(): void {
    this.globalReady = this.loadGlobal()
    for (const entry of this.channels.values()) entry.ready = this.loadChannel(entry)
  }

  /** A channel's numeric id became known: load its badges. A no-op if already registered. */
  registerChannel(platform: string, channel: string, broadcasterId: string): void {
    const key = `${platform}:${channel}`
    if (this.channels.get(key)?.broadcasterId === broadcasterId) return
    const entry: ChannelEntry = { broadcasterId, map: new Map(), ready: Promise.resolve() }
    entry.ready = this.loadChannel(entry)
    this.channels.set(key, entry)
  }

  /** Resolves when badges are loaded, or after a short timeout. See EmoteService.ready(). */
  async ready(platform: string, channel: string): Promise<void> {
    const pending = [this.globalReady, this.channels.get(`${platform}:${channel}`)?.ready]
    await Promise.race([Promise.all(pending), new Promise<void>((r) => setTimeout(r, READY_TIMEOUT_MS).unref?.())])
  }

  /** Returns a copy of the message with badge images attached where we have them. */
  process(msg: ChatMessage): ChatMessage {
    if (msg.platform !== 'twitch' || msg.author.badges.length === 0) return msg
    const channelMap = this.channels.get(`${msg.platform}:${msg.channelId}`)?.map
    const badges: Badge[] = msg.author.badges.map((b) => {
      // Channel badges override global ones (a channel's sub badge replaces the generic one).
      const found = channelMap?.get(b.id) ?? this.globalMap.get(b.id)
      return found ? { ...b, url: found.url, title: found.title } : b
    })
    return { ...msg, author: { ...msg.author, badges } }
  }

  private async loadGlobal(): Promise<void> {
    try {
      const sets = await this.helix.getBadges()
      if (sets) this.globalMap = toMap(sets) // `undefined` means signed out: keep what we have
    } catch (err) {
      console.warn('[badges] global failed:', err instanceof Error ? err.message : err)
    }
  }

  private async loadChannel(entry: ChannelEntry): Promise<void> {
    try {
      const sets = await this.helix.getBadges(entry.broadcasterId)
      if (sets) entry.map = toMap(sets)
    } catch (err) {
      console.warn(`[badges] channel ${entry.broadcasterId} failed:`, err instanceof Error ? err.message : err)
    }
  }
}
