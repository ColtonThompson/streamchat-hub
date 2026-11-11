/**
 * main/twitch/auth.ts
 *
 * WHAT: Signs the user in to Twitch and keeps their access token valid.
 *
 * HOW IT WORKS (the "Device Code" flow, designed for apps that can't host a web page):
 *   1. We ask Twitch for a short code ("ABCD-EFGH") and a URL.
 *   2. We open that URL in the user's browser; they type the code and click Authorize.
 *   3. Meanwhile we poll Twitch every few seconds until it says "approved" and hands us tokens.
 *   No client secret is stored in the app, and no local web server is needed.
 *
 * TOKENS: an *access token* (valid ~4 hours) proves who the user is on each API call; a *refresh
 *   token* trades for a new access token when it expires. Both are encrypted with the operating
 *   system's keychain (Electron `safeStorage`) before being written to disk.
 *
 * PERMISSIONS ("scopes"): Twitch only lets us do what the user approved. We ask in two tiers so the
 *   approval screen only lists what is needed:
 *     - basic:      send chat messages
 *     - moderation: also delete messages, time out and ban (the moderator user panel)
 *     - polls:      also read polls and predictions in the user's OWN channel
 *     - emotes:     also list the emotes the user can use (emote picker)
 *   Asking for one more tier never drops a tier already granted (see `login`).
 *
 * HOW IT FITS: main/index.ts creates one TwitchAuth, forwards its state changes to the UI, and
 *   hands it to the MessageBus -> Helix (twitch/helix.ts), which calls getAccessToken() per request.
 *
 * CHANGE IT WHEN: you need new Twitch permissions (add to the scope lists below, then users must
 *   re-authorize) or want a different token storage strategy.
 */
import { app, safeStorage, shell } from 'electron'
import { isTwitchLoginUrl } from '../security'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AuthState, LoginOptions } from '../../shared/types'

const ID_BASE = 'https://id.twitch.tv/oauth2'

/** Permission to send chat messages. Always requested. */
const BASIC_SCOPES = ['user:write:chat']
/** Permissions for the moderator panel. Only requested when the user clicks "Enable moderation tools". */
const MODERATION_SCOPES = ['moderator:manage:chat_messages', 'moderator:manage:banned_users']
/**
 * Permissions to receive poll and prediction updates. Twitch only grants these for the signed-in
 * user's own channel (the broadcaster), so this is for streamers watching their own stream.
 */
const POLL_SCOPES = ['channel:read:polls', 'channel:read:predictions']
/** Lets us ask "which channels I follow are live right now?" (for go-live notifications). */
const FOLLOW_SCOPES = ['user:read:follows']
/** Reward redemptions in YOUR channel (Twitch only sends them to the broadcaster). */
const REDEMPTION_SCOPES = ['channel:read:redemptions']
/** Lets the emote picker list exactly the emotes YOU can use in a channel. */
const EMOTE_SCOPES = ['user:read:emotes']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What we remember about the signed-in user. */
interface Tokens {
  accessToken: string
  refreshToken?: string
  /** When the access token stops working (ms since 1970). */
  expiresAt: number
  userId: string
  login: string
  /** The permissions Twitch says this token has. Twitch is the source of truth, not what we asked for. */
  scopes: string[]
}

/**
 * Token encryption. Electron 45 deprecated the synchronous safeStorage methods (removed in 46) in favour of async ones,
 * which can read data saved by the old ones. Older Electron versions (and the test stand-in) only have the sync ones.
 */
type AsyncStorage = {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptStringAsync?: (s: string) => Promise<Buffer>
  decryptStringAsync?: (b: Buffer) => Promise<{ shouldReEncrypt: boolean; result: string }>
}
const asyncStorage = safeStorage as unknown as AsyncStorage

async function encryptionAvailable(): Promise<boolean> {
  return asyncStorage.isAsyncEncryptionAvailable ? await asyncStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable()
}
async function encrypt(text: string): Promise<Buffer> {
  return asyncStorage.encryptStringAsync ? asyncStorage.encryptStringAsync(text) : safeStorage.encryptString(text)
}
async function decrypt(data: Buffer): Promise<{ text: string; reEncrypt: boolean }> {
  if (asyncStorage.decryptStringAsync) {
    const r = await asyncStorage.decryptStringAsync(data)
    return { text: r.result, reEncrypt: r.shouldReEncrypt }
  }
  return { text: safeStorage.decryptString(data), reEncrypt: false }
}

/** POST a form to Twitch's login servers and return the status plus the decoded JSON body. */
async function postForm(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000) // never hang forever on a bad network
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

export class TwitchAuth {
  /** Your Twitch app's client id, read from .env at build time (see .env.example). */
  readonly clientId = (import.meta.env.MAIN_VITE_TWITCH_CLIENT_ID ?? '').trim()

  private tokens?: Tokens
  private state: AuthState = { status: 'signed-out', configured: this.clientId !== '' }
  private listeners = new Set<(s: AuthState) => void>()
  /**
   * Counts login attempts. A running login loop checks it is still the latest attempt; bumping the
   * counter (cancel, logout, or a new login) makes any older loop stop on its own.
   */
  private loginRun = 0
  /** If a refresh is already in flight, everyone awaits the same one instead of starting another. */
  private refreshing?: Promise<boolean>
  /** Twitch requires apps that keep a session to re-check the token every hour (see `revalidate`). */
  private revalidateTimer?: NodeJS.Timeout
  /** The OS says the saved tokens should be encrypted again with a newer key (done once after start-up). */
  private needsReEncrypt = false
  private file = join(app.getPath('userData'), 'twitch-auth.bin')

  // ---------------------------------------------------------------------------- read-only info

  /** The signed-in user's Twitch id (used as `sender_id` / `moderator_id` in API calls). */
  get userId(): string | undefined {
    return this.tokens?.userId
  }

  /** True if the token has every permission the moderator panel needs. */
  get canModerate(): boolean {
    return MODERATION_SCOPES.every((s) => this.tokens?.scopes.includes(s))
  }

  /** True if the token has every permission needed to read polls and predictions. */
  get canReadPolls(): boolean {
    return POLL_SCOPES.every((s) => this.tokens?.scopes.includes(s))
  }

  /** True when the token may read Channel Points redemptions (your own channel only). */
  get canReadRedemptions(): boolean {
    return REDEMPTION_SCOPES.every((s) => this.tokens?.scopes.includes(s))
  }

  /** True when the token may list the emotes you can use. */
  get canReadEmotes(): boolean {
    return EMOTE_SCOPES.every((s) => this.tokens?.scopes.includes(s))
  }

  /** True when the token may list the live channels you follow. */
  get canReadFollows(): boolean {
    return FOLLOW_SCOPES.every((s) => this.tokens?.scopes.includes(s))
  }

  /** The signed-in user's login name (lowercase), e.g. "pixelwitch". (Not `login`: that is the sign-in method.) */
  get loginName(): string | undefined {
    return this.tokens?.login
  }

  getState(): AuthState {
    return this.state
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(cb: (s: AuthState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Replace the current state and tell every listener (the UI, the badge loader). */
  private publish(s: Omit<AuthState, 'configured'>): void {
    this.state = { ...s, configured: this.clientId !== '' }
    this.listeners.forEach((cb) => cb(this.state))
  }

  /** Publish "signed in" (or "signed out" if we have no tokens), optionally with a message. */
  private publishCurrent(error?: string): void {
    if (this.tokens) {
      this.publish({
        status: 'signed-in',
        login: this.tokens.login,
        userId: this.tokens.userId,
        canModerate: this.canModerate,
        canReadPolls: this.canReadPolls,
        canReadFollows: this.canReadFollows,
        canReadRedemptions: this.canReadRedemptions,
        canReadEmotes: this.canReadEmotes,
        error
      })
    } else {
      this.publish({ status: 'signed-out', error })
    }
  }

  // ------------------------------------------------------------------------------------ startup

  /** Called once at launch: restore a saved session if there is one and it still works. */
  async init(): Promise<void> {
    if (!this.clientId) return
    const stored = await this.readStored()
    if (!stored) return
    this.tokens = stored
    // validate() also refreshes our knowledge of the scopes; refresh() is the fallback for an expired token.
    const valid = (await this.validate()) || (await this.refresh())
    if (valid) {
      if (this.needsReEncrypt) await this.persist().catch(() => {}) // refresh the encryption key, as Electron advises
      this.publishCurrent()
      this.startRevalidating()
    }
  }

  /** Once an hour: ask Twitch whether the token is still good (and which permissions it has), as Twitch requires. */
  private startRevalidating(): void {
    clearInterval(this.revalidateTimer)
    this.revalidateTimer = setInterval(() => void this.revalidate(), 60 * 60_000)
    this.revalidateTimer.unref?.()
  }

  private async revalidate(): Promise<void> {
    if (!this.tokens) return
    const before = [...this.tokens.scopes].sort().join(' ')
    if (await this.validate()) {
      if (this.tokens && [...this.tokens.scopes].sort().join(' ') !== before) this.publishCurrent() // e.g. revoked in Twitch settings
      return
    }
    await this.refresh() // an expired or revoked token is renewed, or the session is dropped with a message
  }

  // ------------------------------------------------------------------------- login and logout

  /**
   * Start the sign-in flow. Resolves only when the flow ends (approved, expired, cancelled or failed).
   * The UI does NOT wait on this; progress is reported through `publish()` ("pending" + code).
   *
   * @param options extra permission groups to request. Groups the token ALREADY has are always
   *   requested again: a new token only carries the scopes asked for, so leaving one out would silently
   *   take it away (enabling polls must not switch moderation tools off).
   */
  async login(options: LoginOptions = {}): Promise<void> {
    if (!this.clientId) {
      this.publish({ status: 'signed-out', error: 'No Twitch client ID is set up yet. See the README.' })
      return
    }
    const run = ++this.loginRun
    const wanted = [...BASIC_SCOPES]
    if (options.moderation || this.canModerate) wanted.push(...MODERATION_SCOPES)
    if (options.polls || this.canReadPolls) wanted.push(...POLL_SCOPES)
    if (options.follows || this.canReadFollows) wanted.push(...FOLLOW_SCOPES)
    if (options.redemptions || this.canReadRedemptions) wanted.push(...REDEMPTION_SCOPES)
    if (options.emotes || this.canReadEmotes) wanted.push(...EMOTE_SCOPES)
    const scopes = wanted.join(' ')

    try {
      // Step 1: ask Twitch for a code to show the user.
      const d = await postForm(`${ID_BASE}/device`, { client_id: this.clientId, scopes })
      if (!d.ok) throw new Error(d.body.message ?? `Twitch returned ${d.status}`)
      const { device_code, user_code, verification_uri, expires_in, interval } = d.body
      this.publish({ status: 'pending', userCode: user_code, verificationUri: verification_uri })
      // Step 2: open the approval page in the browser, but only if Twitch really sent a twitch.tv address.
      if (!isTwitchLoginUrl(verification_uri)) throw new Error('Twitch sent an unexpected sign-in address, so it was not opened.')
      void shell.openExternal(verification_uri)

      // Step 3: poll until the user approves, the code expires, or this attempt is superseded.
      const deadline = Date.now() + expires_in * 1000
      let wait = (interval ?? 5) * 1000
      while (run === this.loginRun && Date.now() < deadline) {
        await sleep(wait)
        if (run !== this.loginRun) return
        let r
        try {
          r = await postForm(`${ID_BASE}/token`, {
            client_id: this.clientId,
            scopes,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        } catch {
          continue // a brief network hiccup: just poll again
        }
        if (r.ok) {
          await this.completeLogin(r.body, wanted)
          return
        }
        const msg = String(r.body.message ?? '')
        if (msg === 'authorization_pending') continue // the user hasn't clicked Authorize yet
        if (msg === 'slow_down') {
          wait += 5000 // Twitch asked us to poll less often
          continue
        }
        throw new Error(msg || `Twitch returned ${r.status}`)
      }
      if (run === this.loginRun) throw new Error('The code expired. Try again.')
    } catch (err) {
      // Only report if this is still the current attempt (a newer one may have taken over).
      if (run === this.loginRun) this.publishCurrent(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Stop waiting for the browser step. Keeps an existing session: cancelling an "enable
   * moderation" upgrade must not sign you out.
   */
  cancelLogin(): void {
    this.loginRun++
    this.publishCurrent()
  }

  /** Forget the session: delete saved tokens and tell Twitch to revoke the access token. */
  async logout(): Promise<void> {
    this.loginRun++ // also stops a login that is still waiting for approval
    clearInterval(this.revalidateTimer)
    const token = this.tokens?.accessToken
    this.tokens = undefined
    await fs.rm(this.file, { force: true })
    this.publish({ status: 'signed-out' })
    if (token) void postForm(`${ID_BASE}/revoke`, { client_id: this.clientId, token }).catch(() => {})
  }

  /** Called when Twitch approves the code: store the tokens, learn who the user is, and save. */
  private async completeLogin(body: { access_token: string; refresh_token?: string; expires_in: number }, requested: string[]): Promise<void> {
    this.tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      userId: '',
      login: '',
      scopes: []
    }
    // validate() fills in userId, login and scopes.
    if (!(await this.validate())) throw new Error('Twitch accepted the code but the token could not be verified.')
    await this.persist()
    this.startRevalidating()
    // Say plainly if Twitch handed back less than we asked for (a permission left unticked, or a name Twitch rejects).
    const granted = this.tokens.scopes
    const missing = requested.filter((s) => !granted.includes(s))
    console.log(`[auth] signed in as ${this.tokens.login}; permissions: ${granted.join(' ') || '(none)'}${missing.length ? `; NOT granted: ${missing.join(' ')}` : ''}`)
    this.publishCurrent(missing.length ? `Twitch did not grant: ${missing.join(', ')}. Try again and approve every permission listed.` : undefined)
  }

  // ---------------------------------------------------------------------------------- tokens

  /**
   * The token to put in an API request's Authorization header. Refreshes it first if it is about
   * to expire. Returns undefined when nobody is signed in (or the session could not be renewed).
   */
  async getAccessToken(): Promise<string | undefined> {
    if (!this.tokens) return undefined
    if (this.tokens.expiresAt - Date.now() < 60_000 && !(await this.refresh())) return undefined
    return this.tokens?.accessToken
  }

  /** Trade the refresh token for a new access token. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<boolean> {
    const t = this.tokens
    if (!t?.refreshToken) {
      await this.dropSession('Your Twitch session ended. Sign in again.')
      return false
    }
    try {
      const r = await postForm(`${ID_BASE}/token`, {
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: t.refreshToken
      })
      if (!r.ok) {
        // A Twitch outage or rate limit (5xx / 429) says nothing about the login itself: keep it and try again later.
        if (r.status >= 500 || r.status === 429) return false
        await this.dropSession('Your Twitch session ended. Sign in again.')
        return false
      }
      this.tokens = {
        ...t,
        accessToken: r.body.access_token,
        refreshToken: r.body.refresh_token ?? t.refreshToken, // Twitch may rotate the refresh token
        expiresAt: Date.now() + r.body.expires_in * 1000
      }
      await this.persist()
      return true
    } catch {
      return false // network problem: keep the session and try again next time
    }
  }

  /**
   * Ask Twitch "is this token good, and who is it for?". On success, copies the user's id, login,
   * real expiry and permissions into `this.tokens`.
   */
  private async validate(): Promise<boolean> {
    if (!this.tokens) return false
    try {
      const res = await fetch(`${ID_BASE}/validate`, {
        headers: { Authorization: `OAuth ${this.tokens.accessToken}` },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return false
      const v = (await res.json()) as { user_id: string; login: string; expires_in: number; scopes?: string[] }
      this.tokens = {
        ...this.tokens,
        userId: v.user_id,
        login: v.login,
        expiresAt: Date.now() + v.expires_in * 1000,
        scopes: v.scopes ?? []
      }
      return true
    } catch {
      return false
    }
  }

  /** The session is unusable: forget it and show the reason. */
  private async dropSession(error: string): Promise<void> {
    clearInterval(this.revalidateTimer)
    this.tokens = undefined
    await fs.rm(this.file, { force: true })
    this.publish({ status: 'signed-out', error })
  }

  // ----------------------------------------------------------------------------------- storage

  /**
   * Save tokens encrypted. If the OS can't provide encryption (some Linux setups) we deliberately
   * save NOTHING rather than store tokens as plain text; the user just signs in each launch.
   */
  private async persist(): Promise<void> {
    if (!this.tokens || !(await encryptionAvailable())) return
    await fs.writeFile(this.file, await encrypt(JSON.stringify(this.tokens)))
  }

  private async readStored(): Promise<Tokens | undefined> {
    try {
      if (!(await encryptionAvailable())) return undefined
      const { text, reEncrypt } = await decrypt(await fs.readFile(this.file))
      const t = JSON.parse(text) as Tokens
      this.needsReEncrypt = reEncrypt
      return { ...t, scopes: t.scopes ?? [] } // older saves had no `scopes`
    } catch {
      return undefined // missing or unreadable file: treat as signed out
    }
  }
}
