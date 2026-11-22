/**
 * main/streaminfo.ts   (live / offline, title and viewer count of the channels in the feed)
 *
 * WHAT: The UI hands over EVERY channel it is reading (`watch`). This checks them all right away and then every 30 s,
 *   and reports each CHANGE (went live, went offline, new title, viewers moved) through `onInfo` as the full list. It can
 *   also be told to check again straight away (`refresh`: window gets focus, you sign in). With no channels nothing is
 *   fetched at all.
 *
 * If checks keep failing (network, Twitch refusing the token, YouTube changing its page) the last known info is kept but
 * marked `stale` with the reason in `note`, so the bar can say "not updating" instead of quietly showing old data.
 *
 * Where the data comes from: Twitch's `GET /streams` (needs you signed in; ONE request for all Twitch channels); YouTube's
 *   watch page, one request per channel (best effort, see adapters/youtube/innertube.ts `parseWatchStats`).
 *   `StreamInfoWatcher` itself does no network work (the fetcher is injected) so it is easy to test.
 */
import type { StreamInfo, StreamInfoTarget } from '../shared/types'

/**
 * One answer per target, in the same order. `Error` = "couldn't check this one this time" (the previous info stays,
 * and becomes `stale` after a second failure in a row).
 */
export type InfoFetcher = (targets: StreamInfoTarget[]) => Promise<(StreamInfo | Error)[]>

export interface StreamInfoWatcherOptions {
  fetch: InfoFetcher
  onInfo: (infos: StreamInfo[]) => void
  intervalMs?: number
}

const keyOf = (t: StreamInfoTarget): string => `${t.platform}:${t.source}`
/** This many failed checks in a row before the info is called stale (one blip is not worth mentioning). */
const STALE_AFTER = 2

export class StreamInfoWatcher {
  private targets: StreamInfoTarget[] = []
  private timer?: ReturnType<typeof setInterval>
  private lastKey = '[]'
  private infos = new Map<string, StreamInfo>()
  private fails = new Map<string, number>()
  /** Bumped on every change of the channel list, so a slow fetch for an old list is ignored when it finally returns. */
  private generation = 0
  /** The generation a check is running for (-1 = none), so a new list is checked at once even while an old check is still out. */
  private polling = -1

  constructor(private opts: StreamInfoWatcherOptions) {}

  get current(): StreamInfoTarget[] {
    return this.targets
  }

  /** Follow these channels (none = stop). Asking for the list already followed does nothing. */
  watch(targets: StreamInfoTarget[]): void {
    const next = [...new Map(targets.map((t) => [keyOf(t), t])).values()]
    if (next.map(keyOf).join('|') === this.targets.map(keyOf).join('|')) return
    this.stopTimer()
    this.targets = next
    this.generation++
    const keep = new Set(next.map(keyOf))
    for (const k of [...this.infos.keys()]) if (!keep.has(k)) this.infos.delete(k) // never show a removed channel's numbers
    for (const k of [...this.fails.keys()]) if (!keep.has(k)) this.fails.delete(k)
    this.emit()
    if (next.length === 0) return
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 30_000)
    void this.poll()
  }

  stop(): void {
    this.watch([])
  }

  /** Check right now (no-op while a check is already running). */
  refresh(): Promise<void> {
    return this.poll()
  }

  /** One round of checks for every channel. */
  async poll(): Promise<void> {
    const targets = this.targets
    const generation = this.generation
    if (targets.length === 0 || this.polling === generation) return
    this.polling = generation
    let answers: (StreamInfo | Error)[]
    try {
      answers = await this.opts.fetch(targets)
    } catch (e) {
      answers = targets.map(() => (e instanceof Error ? e : new Error(String(e))))
    } finally {
      if (this.polling === generation) this.polling = -1
    }
    if (generation !== this.generation) return // the list changed meanwhile: these answers are for the old one
    targets.forEach((t, i) => {
      const k = keyOf(t)
      const a = answers[i]
      if (a && !(a instanceof Error)) {
        this.fails.delete(k)
        this.infos.set(k, a)
        return
      }
      const n = (this.fails.get(k) ?? 0) + 1
      this.fails.set(k, n)
      const old = this.infos.get(k)
      const why = a instanceof Error ? a.message : 'no answer'
      if (n >= STALE_AFTER) this.infos.set(k, { ...(old ?? { ...t, live: false }), stale: true, note: `Not updating: ${why}` })
    })
    this.emit()
  }

  private emit(): void {
    const list = this.targets.map((t) => this.infos.get(keyOf(t))).filter((i): i is StreamInfo => !!i)
    const key = JSON.stringify(list)
    if (key === this.lastKey) return // unchanged: don't wake the UI
    this.lastKey = key
    this.opts.onInfo(list)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

/** The injected fetcher for the real app: Twitch via Helix (one request), YouTube via its watch page. */
export function makeInfoFetcher(deps: {
  twitchStreams: (logins: string[]) => Promise<Map<string, { title: string; viewers: number; game: string }> | undefined>
  youtubeStats: (source: string) => Promise<{ live: boolean; title?: string; viewers?: number }>
}): InfoFetcher {
  return async (targets) => {
    const out = new Array<StreamInfo | Error>(targets.length)
    const twitch = targets.map((t, i) => ({ t, i })).filter((x) => x.t.platform === 'twitch')
    if (twitch.length) {
      try {
        const live = await deps.twitchStreams(twitch.map((x) => x.t.source))
        for (const { t, i } of twitch) {
          if (live === undefined) out[i] = { ...t, live: false, note: 'Sign in to Twitch to see live status, title and viewer count.' }
          else {
            const s = live.get(t.source.toLowerCase())
            out[i] = s ? { ...t, live: true, title: s.title, viewers: s.viewers, game: s.game || undefined } : { ...t, live: false }
          }
        }
      } catch (e) {
        for (const { i } of twitch) out[i] = e instanceof Error ? e : new Error(String(e))
      }
    }
    await Promise.all(
      targets.map(async (t, i) => {
        if (t.platform !== 'youtube') return
        try {
          const s = await deps.youtubeStats(t.source)
          out[i] = { ...t, live: s.live, ...(s.live && s.title ? { title: s.title } : {}), ...(s.viewers !== undefined ? { viewers: s.viewers } : {}) }
        } catch (e) {
          out[i] = e instanceof Error ? e : new Error(String(e))
        }
      })
    )
    return out
  }
}
