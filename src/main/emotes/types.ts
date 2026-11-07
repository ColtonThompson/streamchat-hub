/**
 * main/emotes/types.ts
 *
 * WHAT: The two shapes shared by the emote code: one emote, and what an emote PROVIDER must offer.
 *
 * VOCABULARY: A "provider" is a third-party emote service (7TV, BetterTTV, FrankerFaceZ). Each has
 *   its own web API and data format; each file in `providers/` converts one of them into the plain
 *   `Emote` shape below so the rest of the code treats them all the same.
 *
 * TO ADD A PROVIDER: create `providers/<name>.ts` exporting an `EmoteProvider`, then add it to the list
 *   in `providers/index.ts`. Its position in that list is its priority.
 */

export interface Emote {
  /** The word people type to use it, e.g. "catJAM". */
  name: string
  url: string
  /** Zero-width emotes are drawn on top of the previous emote instead of beside it. */
  zeroWidth?: boolean
  source: '7tv' | 'bttv' | 'ffz'
}

export interface EmoteProvider {
  name: Emote['source']
  /** Emotes available in every channel. */
  global(): Promise<Emote[]>
  /**
   * Emotes for one Twitch channel, looked up by its numeric Twitch user id.
   * Should return [] (not throw) when the streamer simply has no account on that service.
   */
  channel(twitchId: string): Promise<Emote[]>
}
