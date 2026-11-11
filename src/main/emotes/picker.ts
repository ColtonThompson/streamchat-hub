/**
 * main/emotes/picker.ts   (what the emote picker button shows; pure logic, no network)
 *
 * WHAT: Turns the emote lists we download into the sections of the picker (shared/types.ts `EmoteGroup`).
 *
 * TWO SHAPES OF ANSWER, depending on a Twitch permission:
 *   - WITH "Your emotes" (scope user:read:emotes): Twitch tells us exactly which emotes YOU can use in this channel
 *     (subscriber, follower, bits, other channels you subscribe to, global...). Sections:
 *       #channel   |   Twitch (global)   |   Other channels
 *   - WITHOUT it: we can only list the channel's emotes and the global ones; subscriber emotes you don't own are
 *     included, so the section says some may need a subscription.
 * Then the third-party sets (7TV / BetterTTV / FrankerFaceZ), which anyone can use, are added: this channel's, then global.
 *
 * `TtlCache` remembers each download for a few minutes so opening the picker repeatedly doesn't hit Twitch every time.
 */
import type { EmoteGroup } from '../../shared/types'
import type { Emote } from './types'

/** One Twitch emote as the Helix emote endpoints describe it (only what we use). */
export interface HelixEmote {
  id: string
  name: string
  emote_type?: string
  /** User-emote endpoint only: whose emote it is ("0" for Twitch's global emotes). */
  owner_id?: string
}

export const nativeEmoteUrl = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`

/** Keep well-formed entries from a Helix response body's `data` array. Never throws. */
export function parseHelixEmotes(body: unknown): HelixEmote[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: HelixEmote[] = []
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || !e.id || !e.name) continue
    out.push({
      id: e.id,
      name: e.name,
      emote_type: typeof e.emote_type === 'string' ? e.emote_type : undefined,
      owner_id: typeof e.owner_id === 'string' ? e.owner_id : undefined
    })
  }
  return out
}

export interface PickerInputs {
  /** Channel login, for section titles. */
  channelLogin: string
  /** The channel's numeric Twitch id (to tell its own emotes from other channels'). */
  broadcasterId?: string
  nativeGlobal: HelixEmote[]
  nativeChannel: HelixEmote[]
  /** Present only when the user granted "Your emotes" and the lookup worked. */
  userEmotes?: HelixEmote[]
  thirdChannel: Emote[]
  thirdGlobal: Emote[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** Distinct (by name) entries, sorted for findability. */
function entries(list: { name: string; url: string }[]): { name: string; url: string }[] {
  const seen = new Set<string>()
  const out: { name: string; url: string }[] = []
  for (const e of [...list].sort(byName)) {
    if (seen.has(e.name)) continue
    seen.add(e.name)
    out.push({ name: e.name, url: e.url })
  }
  return out
}

const native = (list: HelixEmote[]) => entries(list.map((e) => ({ name: e.name, url: nativeEmoteUrl(e.id) })))

export function buildGroups(i: PickerInputs): EmoteGroup[] {
  const groups: EmoteGroup[] = []
  const channel = `#${i.channelLogin}`

  if (i.userEmotes) {
    const own = i.userEmotes.filter((e) => !!i.broadcasterId && e.owner_id === i.broadcasterId)
    // Twitch's own emotes have owner "0" (or none: the docs say an empty owner_id means no owner).
    const isTwitch = (e: HelixEmote) => !e.owner_id || e.owner_id === '0'
    const global = i.userEmotes.filter(isTwitch)
    const other = i.userEmotes.filter((e) => !isTwitch(e) && !(i.broadcasterId && e.owner_id === i.broadcasterId))
    groups.push({ id: 'channel', title: channel, emotes: native(own) })
    groups.push({ id: 'twitch', title: 'Twitch', emotes: native(global) })
    groups.push({ id: 'other', title: 'Other channels you can use', emotes: native(other) })
  } else {
    groups.push({ id: 'channel', title: channel, note: 'Subscriber emotes are listed too; you can only use the ones you have unlocked.', emotes: native(i.nativeChannel) })
    groups.push({ id: 'twitch', title: 'Twitch', emotes: native(i.nativeGlobal) })
  }

  groups.push({ id: 'ext-channel', title: `${channel} · 7TV / BTTV / FFZ`, emotes: entries(i.thirdChannel) })
  groups.push({ id: 'ext-global', title: 'Global · 7TV / BTTV / FFZ', emotes: entries(i.thirdGlobal) })
  return groups.filter((g) => g.emotes.length > 0)
}

/** Remembers a value per key for `ttlMs`; `get` runs `load` only when missing or stale. Failures are not remembered. */
export class TtlCache<T> {
  private items = new Map<string, { at: number; value: T }>()
  constructor(
    private ttlMs: number,
    private now: () => number = Date.now
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.items.get(key)
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value
    const value = await load()
    this.items.set(key, { at: this.now(), value })
    return value
  }
}
