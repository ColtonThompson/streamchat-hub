/**
 * main/emotes/providers/seventv.ts   (7TV: https://7tv.app)
 *
 * WHAT: Fetches 7TV emotes: the global set and a channel's personal set.
 *
 * API USED (v3 REST):
 *   GET https://7tv.io/v3/emote-sets/global        -> { emotes: [...] }
 *   GET https://7tv.io/v3/users/twitch/{twitchId}  -> { emote_set: { emotes: [...] } }
 *
 * Each emote lists its image files under `data.host`; we pick the 2x WebP (sharp on high-DPI screens,
 * and smaller than GIF).
 *
 * KNOWN LIMITATION: this is a one-time fetch (refreshed every 15 min by EmoteService). 7TV also
 * offers a live WebSocket for instant updates; not wired up yet.
 */
import { absoluteUrl, getJson } from '../http'
import type { Emote, EmoteProvider } from '../types'

/** The parts of 7TV's response that we use (the real objects have many more fields). */
interface SevenTvEmote {
  name: string
  flags?: number
  data?: { flags?: number; host?: { url: string; files?: { name: string }[] } }
}

/**
 * 7TV marks zero-width emotes with a bit flag, in two places:
 *   - `flags` on the emote as placed in a set (bit value 1)
 *   - `data.flags` on the emote itself (bit value 256)
 * `x & 1` tests whether that bit is set.
 */
const ACTIVE_ZERO_WIDTH = 1
const EMOTE_ZERO_WIDTH = 256

function convert(list: SevenTvEmote[] | undefined): Emote[] {
  const out: Emote[] = []
  for (const e of list ?? []) {
    const host = e.data?.host
    if (!host?.url) continue
    const files = host.files ?? []
    const file = files.find((f) => f.name === '2x.webp') ?? files.find((f) => f.name.startsWith('2x')) ?? files[0]
    if (!file) continue
    out.push({
      name: e.name, // the alias this channel uses, which can differ from the emote's original name
      url: `${absoluteUrl(host.url).replace(/\/$/, '')}/${file.name}`,
      zeroWidth: ((e.flags ?? 0) & ACTIVE_ZERO_WIDTH) !== 0 || ((e.data?.flags ?? 0) & EMOTE_ZERO_WIDTH) !== 0,
      source: '7tv'
    })
  }
  return out
}

export const sevenTv: EmoteProvider = {
  name: '7tv',
  async global() {
    const r = await getJson<{ emotes?: SevenTvEmote[] }>('https://7tv.io/v3/emote-sets/global')
    return convert(r?.emotes)
  },
  async channel(id) {
    const r = await getJson<{ emote_set?: { emotes?: SevenTvEmote[] } | null }>(`https://7tv.io/v3/users/twitch/${id}`)
    return convert(r?.emote_set?.emotes) // emote_set is null for users who never set one up
  }
}
