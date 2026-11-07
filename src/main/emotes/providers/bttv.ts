/**
 * main/emotes/providers/bttv.ts   (BetterTTV: https://betterttv.com)
 *
 * WHAT: Fetches BetterTTV emotes.
 *
 * API USED:
 *   GET https://api.betterttv.net/3/cached/emotes/global        -> [ {id, code, imageType}, ... ]
 *   GET https://api.betterttv.net/3/cached/users/twitch/{id}    -> { channelEmotes: [...], sharedEmotes: [...] }
 *     channelEmotes = uploaded by the streamer; sharedEmotes = added from other users.
 *
 * Images live at https://cdn.betterttv.net/emote/{id}/{1|2|3}x.{png|gif}. We use 2x.
 */
import { getJson } from '../http'
import type { Emote, EmoteProvider } from '../types'

interface BttvEmote {
  id: string
  code: string
  imageType?: string
}

/**
 * BetterTTV's API doesn't flag zero-width ("overlay") emotes; its own browser extension has a
 * hard-coded list, so we do too. If a new overlay emote appears, add its name here.
 */
const ZERO_WIDTH = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat'])

const convert = (list: BttvEmote[] | undefined): Emote[] =>
  (list ?? []).map((e) => ({
    name: e.code,
    url: `https://cdn.betterttv.net/emote/${e.id}/2x.${e.imageType ?? 'png'}`,
    zeroWidth: ZERO_WIDTH.has(e.code),
    source: 'bttv' as const
  }))

export const bttv: EmoteProvider = {
  name: 'bttv',
  async global() {
    return convert(await getJson<BttvEmote[]>('https://api.betterttv.net/3/cached/emotes/global'))
  },
  async channel(id) {
    const r = await getJson<{ channelEmotes?: BttvEmote[]; sharedEmotes?: BttvEmote[] }>(
      `https://api.betterttv.net/3/cached/users/twitch/${id}`
    )
    return convert([...(r?.channelEmotes ?? []), ...(r?.sharedEmotes ?? [])])
  }
}
