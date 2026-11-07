/**
 * main/updater.ts   (checks for, downloads and installs new versions of the app)
 *
 * WHAT: Wraps `electron-updater`. The installer build publishes each release to GitHub Releases; the
 *   installed app asks GitHub "is there something newer than me?", downloads it quietly in the
 *   background, and then offers a "Restart to update" button. If the user ignores it, the update is
 *   installed anyway the next time they quit.
 *
 * HOW THE STATES FLOW (UpdateState in shared/types.ts):
 *     idle -> checking -> none                       (up to date)
 *                      -> available -> downloading -> ready   (restart to install)
 *                      -> error                      (offline, GitHub down...; tries again later)
 *   `disabled` means the app isn't an installed build (npm run dev), so nothing is ever checked.
 *
 * WHEN IT CHECKS: ~10 s after launch (so startup stays fast), then every 4 hours, and whenever the
 *   user presses "Check for updates" in Settings -> About.
 *
 * TESTABILITY: the real `autoUpdater` is passed in (see index.ts), so tests can hand in a fake.
 *
 * PRE-RELEASES: a version like 0.1.0-rc.1 counts as a pre-release; electron-updater then also offers
 *   newer pre-releases. A stable version (0.1.0) only offers stable ones.
 */
import type { UpdateState } from '../shared/types'

/** The small part of electron-updater's `autoUpdater` that we use. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateOptions {
  updater: UpdaterLike
  /** The running app's version (app.getVersion()). */
  version: string
  /** False when running from source: nothing to update. */
  enabled: boolean
  onState: (state: UpdateState) => void
  firstCheckMs?: number
  intervalMs?: number
  now?: () => number
}

export class UpdateService {
  private state: UpdateState
  private timers: ReturnType<typeof setTimeout>[] = []
  private interval?: ReturnType<typeof setInterval>
  private disposed = false

  constructor(private o: UpdateOptions) {
    this.state = o.enabled ? { status: 'idle', version: o.version } : { status: 'disabled', version: o.version }
    if (!o.enabled) return
    const u = o.updater
    u.autoDownload = true // fetch in the background as soon as an update is found
    u.autoInstallOnAppQuit = true // ...and install it when the user next quits
    u.on('checking-for-update', () => this.set({ status: 'checking', version: o.version }))
    u.on('update-not-available', () => this.set({ status: 'none', version: o.version, checkedAt: this.now() }))
    u.on('update-available', (info: { version?: string }) =>
      this.set({ status: 'available', version: o.version, next: info?.version ?? '?' })
    )
    u.on('download-progress', (p: { percent?: number }) => {
      const next = this.nextVersion()
      if (next) this.set({ status: 'downloading', version: o.version, next, percent: clamp(p?.percent ?? 0) })
    })
    u.on('update-downloaded', (info: { version?: string }) =>
      this.set({ status: 'ready', version: o.version, next: info?.version ?? this.nextVersion() ?? '?' })
    )
    u.on('error', (err: unknown) => this.set({ status: 'error', version: o.version, message: describe(err) }))
  }

  getState(): UpdateState {
    return this.state
  }

  /** Begin the schedule. Safe to call once; does nothing when disabled. */
  start(): void {
    if (!this.o.enabled || this.disposed) return
    this.timers.push(setTimeout(() => void this.check(), this.o.firstCheckMs ?? 10_000))
    this.interval = setInterval(() => void this.check(), this.o.intervalMs ?? 4 * 60 * 60 * 1000)
  }

  /** Look for an update now. Ignored while busy, or once an update is already downloaded. */
  async check(): Promise<void> {
    if (!this.o.enabled || this.disposed) return
    const s = this.state.status
    if (s === 'checking' || s === 'downloading' || s === 'ready') return
    try {
      await this.o.updater.checkForUpdates()
    } catch (err) {
      // electron-updater usually also emits 'error'; setting it twice is harmless.
      this.set({ status: 'error', version: this.o.version, message: describe(err) })
    }
  }

  /** Quit and install. Only when an update has finished downloading. */
  install(): void {
    if (this.state.status !== 'ready' || this.disposed) return
    // (isSilent, forceRunAfter): show no installer UI, and start the app again afterwards.
    this.o.updater.quitAndInstall(true, true)
  }

  dispose(): void {
    this.disposed = true
    this.timers.forEach(clearTimeout)
    if (this.interval) clearInterval(this.interval)
  }

  private nextVersion(): string | undefined {
    const s = this.state
    return 'next' in s ? s.next : undefined
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  private set(state: UpdateState): void {
    if (this.disposed) return
    // Don't let a late 'checking' or error overwrite a finished download: "ready" must stick.
    if (this.state.status === 'ready' && state.status !== 'ready') return
    this.state = state
    this.o.onState(state)
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** A short, human-readable reason (electron-updater errors can be very long). */
function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const first = msg.split('\n')[0].trim()
  return first.length > 160 ? first.slice(0, 157) + '...' : first || 'unknown error'
}
