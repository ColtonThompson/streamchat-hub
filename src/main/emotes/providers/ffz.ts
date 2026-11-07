/**
 * main/emotes/providers/ffz.ts   (FrankerFaceZ: https://www.frankerfacez.com)
 *
 * WHAT: Fetches FrankerFaceZ emotes.
 *
 * API USED:
 *   GET https://api.frankerfacez.com/v1/set/global       -> { default_sets: [3], sets: { "3": {emoticons: [...]} } }
 *   GET https://api.frankerfacez.com/v1/room/id/{id}     -> { sets: { "<setId>": {emoticons: [...]} } }
 *
 * FFZ groups emotes into numbered "sets". For global emotes only the sets listed in `default_sets`
 * apply; for a channel ("room") we take every set returned. Each emote has `urls` keyed by size
 * ("1", "2", "4"); we use "2".
 */
import { absoluteUrl, getJson } from '../http'
import type { Emote, EmoteProvider } from '../types'

interface FfzEmoticon {
  name: string
  urls: Record<string, string>
}
interface FfzSet {
  emoticons?: FfzEmoticon[]
}

function convert(sets: (FfzSet | undefined)[]): Emote[] {
  const out: Emote[] = []
  for (const set of sets) {
    for (const e of set?.emoticons ?? []) {
      const url = e.urls['2'] ?? e.urls['1'] // fall back to the small size if there is no 2x
      if (url) out.push({ name: e.name, url: absoluteUrl(url), source: 'ffz' })
    }
  }
  return out
}

export const ffz: EmoteProvider = {
  name: 'ffz',
  async global() {
    const r = await getJson<{ default_sets?: number[]; sets?: Record<string, FfzSet> }>('https://api.frankerfacez.com/v1/set/global')
    return convert((r?.default_sets ?? []).map((id) => r?.sets?.[String(id)]))
  },
  async channel(id) {
    const r = await getJson<{ sets?: Record<string, FfzSet> }>(`https://api.frankerfacez.com/v1/room/id/${id}`)
    return convert(Object.values(r?.sets ?? {}))
  }
}
