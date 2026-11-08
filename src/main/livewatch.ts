/**
 * main/livewatch.ts   (desktop notifications when a channel you follow goes live)
 *
 * WHAT: Every minute, asks Twitch which of the channels you follow are live (Helix /streams/followed),
 *   compares that with the previous answer, and notifies you about channels that just appeared:
 *   "PixelWitch is live - Playing Hades II".
 *
 * RULES (each one avoids a real annoyance):
 *   - The FIRST answer after starting is only remembered, never announced, or every stream that was
 *     already live would pop up each time you open the app.
 *   - A channel that drops out and comes back within 10 minutes (stream hiccups, brief disconnects)
 *     isn't announced again.
 *   - Channels whose type isn't "live", and your own channel, are skipped.
 *   - If many go live at once (more than 3), one summary is shown instead of a pile of pop-ups.
 *   - A failed lookup (offline, Twitch down) keeps what we knew and just tries again next minute. A
 *     401/403 means the permission is gone, so polling stops until it is switched on again.
 *
 * TESTABILITY: Twitch, the notification and the timer are injected (see the options), so tests can drive it.
 */
import type { LiveStream } from './twitch/helix'

export interface Announcement {
  title: string
  body: string
  /** Where clicking the notification goes (the channel page), when there is a single channel. */
  url?: string
}

export interface LiveWatchOptions {
  /** Current followed-and-live list; undefined = signed out. May throw (an object with a numeric `status` for HTTP errors). */
  fetchLive: () => Promise<LiveStream[] | undefined>
  announce: (a: Announcement) => void
  /** Called with everything live right now after each check, and with [] when the watcher stops. */
  onList?: (live: LiveStream[]) => void
  /** Asked at announcement time: false keeps the list updating but shows no notifications. Default: on. */
  alertsOn?: () => boolean
  /** Id of the signed-in user, to skip their own channel. */
  selfId: () => string | undefined
  intervalMs?: number
  /** How long a channel that went offline stays "known" so a quick return isn't re-announced. */
  rememberMs?: number
  now?: () => number
}

export class LiveWatcher {
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private baseline = true
  /** channel id -> last time it was seen live. Entries survive `rememberMs` after the channel disappears. */
  private seen = new Map<string, number>()

  constructor(private o: LiveWatchOptions) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.baseline = true
    this.seen.clear()
    void this.tick()
  }

  stop(): void {
    const was = this.running
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (was) this.o.onList?.([])
  }

  get active(): boolean {
    return this.running
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    let stopForGood = false
    try {
      const live = await this.o.fetchLive()
      if (!this.running) return
      if (live) this.process(live)
      else {
        console.log('[livewatch] not signed in; nothing to check')
        this.o.onList?.([])
      }
    } catch (err) {
      const status = (err as { status?: number })?.status
      console.warn(`[livewatch] lookup failed${status ? ` (HTTP ${status})` : ''}: ${(err as Error)?.message ?? err}`)
      if (status === 401 || status === 403) stopForGood = true
      // anything else: keep going, the next tick retries
    }
    if (!this.running) return
    if (stopForGood) {
      this.stop()
      return
    }
    this.timer = setTimeout(() => void this.tick(), this.o.intervalMs ?? 60_000)
  }

  private process(live: LiveStream[]): void {
    const t = this.now()
    const self = this.o.selfId()
    const fresh: LiveStream[] = []
    for (const s of live) {
      if (!s.live || s.userId === self) continue
      if (!this.seen.has(s.userId)) fresh.push(s)
      this.seen.set(s.userId, t)
    }
    const keep = this.o.rememberMs ?? 10 * 60_000
    for (const [id, last] of this.seen) if (t - last > keep) this.seen.delete(id)

    console.log(`[livewatch] ${live.length} followed channel(s) live, ${fresh.length} new${this.baseline ? ' (first check: remembered, not announced)' : ''}`)
    this.o.onList?.(live.filter((s) => s.live))
    if (this.baseline) {
      this.baseline = false
      return
    }
    if (this.o.alertsOn && !this.o.alertsOn()) return // list stays current; just no notifications
    if (fresh.length === 0) return
    if (fresh.length > 3) {
      const names = fresh.slice(0, 3).map((s) => s.name).join(', ')
      this.o.announce({ title: `${fresh.length} channels you follow went live`, body: `${names} and ${fresh.length - 3} more` })
      return
    }
    for (const s of fresh) {
      this.o.announce({
        title: `${s.name} is live`,
        body: s.game ? `Playing ${s.game}${s.title ? ` · ${s.title}` : ''}` : s.title || 'Just went live',
        url: `https://www.twitch.tv/${encodeURIComponent(s.login)}`
      })
    }
  }
}
