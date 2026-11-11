/**
 * main/streaminfo.ts   (title and viewer count of the ONE stream being read)
 *
 * WHAT: When the UI is reading exactly one stream and the user has the "show stream info" setting on, it asks
 *   for that stream here (`watch`). This keeps its title and viewer count fresh (every 45 s) and reports each
 *   CHANGE through `onInfo`. With no target (or the setting off) nothing is fetched at all.
 *
 * Where the data comes from: Twitch's `GET /streams` (needs you signed in); YouTube's watch page (best effort,
 *   see adapters/youtube/innertube.ts `parseWatchStats`). `StreamInfoWatcher` itself does no network work (the
 *   fetchers are injected) so it is easy to test.
 */
import type { StreamInfo, StreamInfoTarget } from '../shared/types'

/** `undefined` from a fetcher = "couldn't tell this time": the previous info stays. */
export type InfoFetcher = (target: StreamInfoTarget) => Promise<StreamInfo | undefined>

export interface StreamInfoWatcherOptions {
  fetch: InfoFetcher
  onInfo: (info: StreamInfo | null) => void
  intervalMs?: number
}

export class StreamInfoWatcher {
  private target: StreamInfoTarget | null = null
  private timer?: ReturnType<typeof setInterval>
  private lastKey = 'null'
  /** Bumped on every change of target, so a slow fetch for an old target is ignored when it finally returns. */
  private generation = 0

  constructor(private opts: StreamInfoWatcherOptions) {}

  get current(): StreamInfoTarget | null {
    return this.target
  }

  /** Follow this stream (or nothing). Asking for the one already followed does nothing. */
  watch(target: StreamInfoTarget | null): void {
    const same = (!target && !this.target) || (!!target && !!this.target && target.platform === this.target.platform && target.source === this.target.source)
    if (same) return
    this.stopTimer()
    this.target = target
    this.generation++
    this.emit(null) // never show the previous stream's numbers for the new one
    if (!target) return
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 45_000)
    void this.poll()
  }

  stop(): void {
    this.watch(null)
  }

  /** One fetch for the current target. */
  async poll(): Promise<void> {
    const target = this.target
    const generation = this.generation
    if (!target) return
    let info: StreamInfo | undefined
    try {
      info = await this.opts.fetch(target)
    } catch {
      return // a network problem: keep what is showing, try again next round
    }
    if (info && generation === this.generation) this.emit(info)
  }

  private emit(info: StreamInfo | null): void {
    const key = JSON.stringify(info)
    if (key === this.lastKey) return // unchanged: don't wake the UI
    this.lastKey = key
    this.opts.onInfo(info)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

/** The injected fetcher for the real app: Twitch via Helix, YouTube via its watch page. */
export function makeInfoFetcher(deps: {
  twitchStream: (login: string) => Promise<{ title: string; viewers: number; game: string } | null | undefined>
  youtubeStats: (source: string) => Promise<{ live: boolean; title?: string; viewers?: number }>
}): InfoFetcher {
  return async (t) => {
    if (t.platform === 'twitch') {
      const s = await deps.twitchStream(t.source)
      if (s === undefined) return { ...t, live: false, note: 'Sign in to Twitch to see the title and viewer count.' }
      return s === null ? { ...t, live: false } : { ...t, live: true, title: s.title, viewers: s.viewers, game: s.game || undefined }
    }
    const s = await deps.youtubeStats(t.source)
    return { ...t, live: s.live, ...(s.live && s.title ? { title: s.title } : {}), ...(s.viewers !== undefined ? { viewers: s.viewers } : {}) }
  }
}
