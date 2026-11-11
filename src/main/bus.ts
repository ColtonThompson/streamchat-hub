/**
 * main/bus.ts   (the "message bus": the heart of the main process)
 *
 * WHAT: Sits between the platform adapters and the UI. Everything that happens in a chat flows
 *       through here, and every request from the UI that needs a platform goes out through here.
 *
 * INCOMING (chat -> UI):
 *     adapter --message/moderation--> bus --(add emotes, badge images)--> batch --> UI
 *   - Adapters (Twitch...) call the `emit` functions we give them in `setEnabled`.
 *   - Each message is "enriched": third-party emotes (EmoteService) and badge images (BadgeService).
 *   - Results are collected in a queue and sent to the UI every 50 ms in one batch. Sending each
 *     message separately would flood the connection to the UI on a busy chat.
 *
 * OUTGOING (UI -> platform):
 *   - `send()` posts a chat message; `moderate()` deletes / times out / bans / unbans.
 *   - Both validate their input (it came from the UI, which is untrusted) and then call Helix.
 *
 * POLLS & PREDICTIONS: when you are signed in with the polls permission, Twitch is on, and your OWN channel
 *   is in the Twitch box, the bus opens an EventSub connection (twitch/eventsub.ts). Its events become a
 *   live card state (`activity` items) plus a few feed rows. See `syncActivity` below.
 *
 * ORDERING: messages and moderation updates all go through `this.chain`, a promise chain that
 *   processes one item at a time in arrival order. This guarantees "message deleted" is never
 *   applied before the message itself, even if that message had to wait for its emotes to load.
 *
 * CHANGE IT WHEN: you add a new kind of enrichment (e.g. translating messages: do it in `enqueue`),
 *   or a new request the UI can make that targets a platform (add a method here, a handler in
 *   main/index.ts).
 */
import type { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import {
  IPC,
  type ActionResult,
  type ChannelActivity,
  type ChatMessage,
  type FeedItem,
  type EmoteGroup,
  type ModerationCommand,
  type ModerationEvent,
  type Platform,
  type PlatformStatus
} from '../shared/types'
import { TIMEOUT_MAX, TIMEOUT_MIN } from '../shared/duration'
import { createAdapter } from './adapters'
import type { ChatAdapter } from './adapters/base'
import { buildGroups, TtlCache, type HelixEmote } from './emotes/picker'
import { EmoteService } from './emotes/service'
import { ACTIVITY_EVENTS, parseActivityEvent, parseRedemptionEvent, REDEMPTION_EVENTS } from './twitch/activity'
import { parseTwitchPin, PinWatcher } from './twitch/pins'
import type { TwitchAuth } from './twitch/auth'
import { BadgeService } from './twitch/badges'
import { EventSubClient, type EventSubState, type SocketLike } from './twitch/eventsub'
import { Helix } from './twitch/helix'

/** Twitch's longest allowed timeout: two weeks, in seconds. */
/** Twitch user ids are numbers; message ids are UUID-like. These patterns reject anything odd. */
const USER_ID = /^\d{1,20}$/
const MESSAGE_ID = /^[A-Za-z0-9-]{1,64}$/

export class MessageBus {
  /** The connected adapters, one per enabled platform. */
  private adapters = new Map<Platform, ChatAdapter>()
  /** Items waiting to be sent to the UI in the next 50 ms batch. */
  private queue: FeedItem[] = []
  private flushTimer: NodeJS.Timeout
  private emotes = new EmoteService()
  /** Twitch emote lists for the picker, kept a few minutes each. */
  private nativeGlobal = new TtlCache<HelixEmote[]>(60 * 60_000)
  private nativeChannel = new TtlCache<HelixEmote[]>(15 * 60_000)
  private userEmotes = new TtlCache<HelixEmote[]>(5 * 60_000)
  private helix: Helix
  private badges: BadgeService
  /**
   * "platform:channel" -> the platform's numeric id for that channel. Twitch's API needs the
   * numeric id, but we only know channels by name until the adapter tells us the id.
   */
  private channelIds = new Map<string, string>()
  private unsubscribeAuth: () => void
  /** Serializes processing so order is preserved (see "ORDERING" above). */
  private chain: Promise<void> = Promise.resolve()
  /** The channel names currently typed in the Twitch box (to know whether YOUR channel is among them). */
  private twitchChannels: string[] = []
  /** The poll/prediction connection, when one is running. */
  private activityClient?: EventSubClient
  /** Which user the running connection belongs to ('' = none); lets `syncActivity` tell if anything changed. */
  private activityFor = ''
  /** The last state we told the user about, so each change is announced once. */
  private activityNotice = ''
  /** Ids of poll / prediction / redemption rows already sent: a row for the same moment is never sent twice. */
  private activityRowsSent = new Set<string>()
  /** Watches Twitch pinned messages (needs the moderation permission). */
  private pinWatch?: PinWatcher

  constructor(
    private win: BrowserWindow,
    private auth: TwitchAuth
  ) {
    this.flushTimer = setInterval(() => this.flush(), 50)
    this.helix = new Helix(auth)
    this.badges = new BadgeService(this.helix)

    // Badge images need a signed-in user. Load them when sign-in happens (and right now if
    // already signed in). `wasSignedIn` prevents reloading on every unrelated auth update.
    let wasSignedIn = false
    this.unsubscribeAuth = auth.onChange((s) => {
      const signedIn = s.status === 'signed-in'
      if (signedIn && !wasSignedIn) this.badges.reload()
      wasSignedIn = signedIn
      this.syncActivity() // permissions or the account may have changed
    })
    if (auth.getState().status === 'signed-in') {
      wasSignedIn = true
      this.badges.reload()
    }
  }

  // ------------------------------------------------------------------ platform connections

  /** Turn a platform on or off. Creates and connects an adapter, or disconnects the existing one. */
  async setEnabled(platform: Platform, enabled: boolean, channels: string[]): Promise<void> {
    const existing = this.adapters.get(platform)
    if (!enabled) {
      existing?.disconnect()
      this.adapters.delete(platform)
      if (platform === 'twitch') this.syncActivity()
      return
    }
    if (existing) return // already on
    if (platform === 'twitch') this.twitchChannels = channels

    // The `emit` object is how an adapter hands data to the bus. See adapters/base.ts.
    const adapter = createAdapter(
      platform,
      {
        message: (m) => this.enqueue(m),
        moderation: (a) => this.enqueueModeration(a),
        pin: (p) => this.enqueuePin({ kind: 'pin', pin: p }),
        unpin: (channelId) => this.enqueuePin({ kind: 'unpin', platform, channelId }),
        status: (s) => this.sendStatus(platform, s),
        channelReady: (channel, id) => {
          // The adapter learned a channel's numeric id: remember it and start loading emotes/badges.
          this.channelIds.set(`${platform}:${channel}`, id)
          this.emotes.registerChannel(platform, channel, id)
          this.badges.registerChannel(platform, channel, id)
          if (platform === 'twitch') void this.pinWatch?.poll() // a newly joined channel may already have a pin
        }
      },
      channels
    )
    this.adapters.set(platform, adapter)
    if (platform === 'twitch') this.syncActivity()
    try {
      await adapter.connect()
    } catch (err) {
      this.sendStatus(platform, { state: 'error', detail: err instanceof Error ? err.message : String(err) })
      this.adapters.delete(platform)
    }
  }

  /** Change the channel list of a connected platform without reconnecting. */
  setChannels(platform: Platform, channels: string[]): void {
    this.adapters.get(platform)?.setChannels?.(channels)
    if (platform === 'twitch') {
      this.twitchChannels = channels
      this.syncActivity()
    }
  }

  // ---------------------------------------------------------------- polls and predictions

  /**
   * Start or stop the poll/prediction connection so it matches the situation. Called whenever something
   * that matters changes (sign-in state, Twitch on/off, the channel list). Safe to call any time: it only
   * acts when the answer to "should it be running?" changed.
   *
   * It should run only when ALL of these are true:
   *   - you are signed in with the polls & predictions permission
   *   - Twitch is switched on
   *   - YOUR channel is one of those being read (Twitch only shows a channel's polls to its own broadcaster)
   */
  private syncActivity(): void {
    this.syncPins()
    const login = this.auth.loginName
    const userId = this.auth.userId
    const polls = this.auth.canReadPolls
    const redemptions = this.auth.canReadRedemptions
    const want = !!login && !!userId && (polls || redemptions) && this.adapters.has('twitch') && this.twitchChannels.includes(login)
    // The key changes when a permission is added or removed, which restarts the connection with the right event types.
    const key = want ? `${userId}:${polls ? 'p' : ''}${redemptions ? 'r' : ''}` : ''
    if (key === this.activityFor) return

    this.activityClient?.stop()
    this.activityClient = undefined
    this.activityFor = key
    if (!want) {
      this.activityNotice = ''
      return
    }
    this.activityClient = new EventSubClient({
      types: [...(polls ? ACTIVITY_EVENTS : []), ...(redemptions ? REDEMPTION_EVENTS : [])],
      // The `ws` WebSocket has the few methods EventSubClient uses; the cast just satisfies its simpler interface.
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      subscribe: (type, sessionId) => this.helix.subscribeEventSub(type, userId as string, sessionId),
      onNotification: (type, event) => {
        // One line per event Twitch sends, so a repeated event can be spotted in the terminal.
        console.log(`[activity] ${type} ${(event as { id?: string } | undefined)?.id ?? ''}`)
        const redemption = parseRedemptionEvent(type, event)
        if (redemption) {
          this.enqueueActivityRow(redemption)
          return
        }
        const update = parseActivityEvent(type, event)
        if (!update) return
        this.enqueueActivity(update.activity)
        if (update.row) this.enqueueActivityRow(update.row)
      },
      onState: (state) => this.announceActivity(state, login as string),
      onSubscribed: (results) => this.reportSubscriptions(results, login as string)
    })
    console.log(`[activity] watching ${login}: ${[polls ? 'polls/predictions' : '', redemptions ? 'redemptions' : ''].filter(Boolean).join(' + ')}`)
    this.activityClient.start()
  }

  /**
   * A poll / prediction / redemption row. Each has a stable id ("the end of poll X"), and a row with an id
   * already sent is dropped here, so no path (a repeated Twitch notification, a restarted connection)
   * can show the same moment twice.
   */
  private enqueueActivityRow(row: ChatMessage): void {
    if (this.activityRowsSent.has(row.id)) return
    this.activityRowsSent.add(row.id)
    if (this.activityRowsSent.size > 500) this.activityRowsSent.delete(this.activityRowsSent.values().next().value as string)
    this.enqueue(row)
  }

  // ------------------------------------------------------------------------ pinned messages

  /**
   * Start or stop watching Twitch pins. Runs while Twitch is on and you are signed in with the moderation
   * permission (the pin API needs you to be a moderator or the broadcaster of the channel; channels where
   * you are not are skipped quietly).
   */
  private syncPins(): void {
    const should = this.adapters.has('twitch') && this.auth.canModerate && !!this.auth.userId
    if (should && !this.pinWatch) {
      this.pinWatch = new PinWatcher({
        targets: () => this.twitchChannels.flatMap((login) => {
          const id = this.channelIds.get(`twitch:${login}`)
          return id ? [{ login, id }] : []
        }),
        fetchPin: async (t) => {
          const me = this.auth.userId
          if (!me) return undefined
          const data = await this.helix.getPinnedChat(t.id, me)
          if (data === undefined) return undefined
          return data === null ? null : (parseTwitchPin(t.login, data) ?? null)
        },
        onPin: (pin) => this.enqueuePin({ kind: 'pin', pin }),
        onUnpin: (login) => this.enqueuePin({ kind: 'unpin', platform: 'twitch', channelId: login })
      })
      this.pinWatch.start()
    } else if (!should && this.pinWatch) {
      this.pinWatch.stop()
      this.pinWatch = undefined
    }
  }

  private enqueuePin(item: Extract<FeedItem, { kind: 'pin' | 'unpin' }>): void {
    this.chain = this.chain.then(() => {
      this.queue.push(item)
    })
  }

  /**
   * Log what Twitch accepted, and when only SOME event types were accepted say so in the feed (once), naming the
   * ones that were refused. Without this a refused type (say, reward redemptions) would just never show anything.
   */
  private reportSubscriptions(results: { type: string; ok: boolean; error?: string }[], login: string): void {
    for (const r of results) console.log(`[activity] ${r.ok ? 'subscribed' : 'REFUSED'} ${r.type}${r.error ? ` (${r.error})` : ''}`)
    const failed = results.filter((r) => !r.ok)
    if (!failed.length || failed.length === results.length) return // none failed, or all (announceActivity reports that)
    const names = failed.map((f) => (f.type.includes('redemption') ? 'reward redemptions' : f.type.replace('channel.', '').split('.')[0] + 's'))
    const title = `Not available: ${[...new Set(names)].join(', ')} (${failed[0].error ?? 'Twitch refused'})`
    this.enqueue({
      id: `activity-notice-partial-${Date.now()}`,
      platform: 'twitch',
      channelId: login,
      author: { name: '', badges: [] },
      parts: [],
      timestamp: Date.now(),
      event: { type: 'notice', title }
    })
  }

  /** Tell the user (once per change) what is being watched, as a quiet row in the feed. */
  private announceActivity(state: EventSubState, login: string): void {
    const notice = state.state === 'connecting' ? '' : state.state === 'connected' ? 'connected' : `error:${state.message}`
    if (!notice || notice === this.activityNotice) return
    this.activityNotice = notice
    const polls = this.auth.canReadPolls
    const redemptions = this.auth.canReadRedemptions
    const what = polls && redemptions ? 'polls, predictions & reward redemptions' : redemptions ? 'reward redemptions' : 'polls & predictions'
    const title = state.state === 'error' ? `${what[0].toUpperCase()}${what.slice(1)} unavailable: ${state.message}` : `Watching your ${what}`
    this.enqueue({
      id: `activity-notice-${Date.now()}`,
      platform: 'twitch',
      channelId: login,
      author: { name: '', badges: [] },
      parts: [],
      timestamp: Date.now(),
      event: { type: 'notice', title }
    })
  }

  // ---------------------------------------------------------------- requests from the UI

  /**
   * The emote picker's sections for a channel. Each Twitch lookup that fails (offline, missing permission) just leaves
   * its section out, so the picker still shows whatever did load.
   */
  async listEmotes(platform: Platform, channel: string): Promise<EmoteGroup[]> {
    if (platform !== 'twitch') return []
    const broadcasterId = this.channelIds.get(`twitch:${channel}`)
    const userId = this.auth.userId
    const quiet = async (label: string, load: () => Promise<HelixEmote[] | undefined>): Promise<HelixEmote[] | undefined> => {
      try {
        return await load()
      } catch (err) {
        console.warn(`[emotes] picker: ${label} failed:`, err instanceof Error ? err.message : err)
        return undefined
      }
    }
    const [nativeGlobal, nativeChannel, userEmotes] = await Promise.all([
      quiet('global', () => this.nativeGlobal.get('global', async () => (await this.helix.getGlobalEmotes()) ?? [])),
      broadcasterId ? quiet('channel', () => this.nativeChannel.get(broadcasterId, async () => (await this.helix.getChannelEmotes(broadcasterId)) ?? [])) : undefined,
      broadcasterId && userId && this.auth.canReadEmotes
        ? quiet('yours', () => this.userEmotes.get(`${userId}:${broadcasterId}`, async () => (await this.helix.getUserEmotes(userId, broadcasterId)) ?? []))
        : undefined
    ])
    const third = this.emotes.list('twitch', channel)
    return buildGroups({
      channelLogin: channel,
      broadcasterId,
      nativeGlobal: nativeGlobal ?? [],
      nativeChannel: nativeChannel ?? [],
      userEmotes: userEmotes && userEmotes.length > 0 ? userEmotes : undefined,
      thirdChannel: third.channel,
      thirdGlobal: third.global
    })
  }

  /** Send a chat message as the signed-in user. */
  async send(platform: Platform, channel: string, text: string): Promise<ActionResult> {
    if (platform !== 'twitch') return { ok: false, error: 'Sending is only available on Twitch for now.' }
    const message = text.trim().slice(0, 500) // Twitch's limit is 500 characters
    if (!message) return { ok: false, error: 'Type a message first.' }
    const senderId = this.auth.userId
    if (!senderId) return { ok: false, error: 'Sign in to Twitch to send messages.' }
    const broadcasterId = this.channelIds.get(`twitch:${channel}`)
    if (!broadcasterId) return { ok: false, error: `Still joining #${channel}. Try again in a moment.` }
    try {
      return await this.helix.sendChat(broadcasterId, senderId, message)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Delete a message, or time out / ban / unban a user.
   *
   * We do NOT change anything on screen here. If Twitch accepts the action it broadcasts it on
   * the chat connection (CLEARMSG / CLEARCHAT), the Twitch adapter turns that into a
   * ModerationEvent, and the UI updates from that. One source of truth for what the channel looks like.
   */
  async moderate(cmd: ModerationCommand): Promise<ActionResult> {
    if (cmd.platform !== 'twitch') return { ok: false, error: 'Moderation is only available on Twitch for now.' }
    const moderatorId = this.auth.userId
    if (!moderatorId) return { ok: false, error: 'Sign in to Twitch first.' }
    if (!this.auth.canModerate) return { ok: false, error: 'Turn on moderation tools first (Settings → Accounts).' }

    const broadcasterId = this.channelIds.get(`twitch:${cmd.channel}`)
    if (!broadcasterId) return { ok: false, error: `Still joining #${cmd.channel}. Try again in a moment.` }

    try {
      switch (cmd.action) {
        case 'delete':
          if (!MESSAGE_ID.test(cmd.messageId)) return { ok: false, error: 'Invalid message.' }
          return await this.helix.deleteMessage(broadcasterId, moderatorId, cmd.messageId)
        case 'timeout':
          if (!USER_ID.test(cmd.userId)) return { ok: false, error: 'Invalid user.' }
          if (!Number.isInteger(cmd.durationSec) || cmd.durationSec < TIMEOUT_MIN || cmd.durationSec > TIMEOUT_MAX) {
            return { ok: false, error: 'Timeout length must be between 1 second and 2 weeks.' }
          }
          return await this.helix.ban(broadcasterId, moderatorId, cmd.userId, cmd.durationSec)
        case 'ban':
          if (!USER_ID.test(cmd.userId)) return { ok: false, error: 'Invalid user.' }
          return await this.helix.ban(broadcasterId, moderatorId, cmd.userId)
        case 'unban':
          if (!USER_ID.test(cmd.userId)) return { ok: false, error: 'Invalid user.' }
          return await this.helix.unban(broadcasterId, moderatorId, cmd.userId)
        default:
          return { ok: false, error: 'Unknown moderation action.' }
      }
    } catch (err) {
      // Typically a network failure or timeout.
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Stop everything (called when the window closes). */
  dispose(): void {
    clearInterval(this.flushTimer)
    this.unsubscribeAuth()
    this.activityClient?.stop()
    this.pinWatch?.stop()
    this.emotes.dispose()
    this.adapters.forEach((a) => a.disconnect())
    this.adapters.clear()
  }

  // ----------------------------------------------------------------------- the pipeline

  /** A new message from an adapter: wait for its emotes/badges, enrich it, queue it. */
  private enqueue(m: ChatMessage): void {
    this.chain = this.chain.then(async () => {
      try {
        // `ready()` resolves immediately once a channel's emotes are loaded, or after a short
        // timeout, so a slow emote server can never stall the chat.
        await Promise.all([this.emotes.ready(m.platform, m.channelId), this.badges.ready(m.platform, m.channelId)])
        this.queue.push({ kind: 'message', message: this.badges.process(this.emotes.process(m)) })
      } catch {
        this.queue.push({ kind: 'message', message: m }) // never drop a message because enrichment failed
      }
    })
  }

  /**
   * A new state of a live poll/prediction. Goes through the chain too, so it stays in order with the
   * rows. Votes can arrive many times a second, so an update still waiting to be sent is REPLACED by the
   * newer one for the same poll rather than queued behind it.
   */
  private enqueueActivity(activity: ChannelActivity): void {
    this.chain = this.chain.then(() => {
      const i = this.queue.findIndex((x) => x.kind === 'activity' && x.activity.kind === activity.kind && x.activity.id === activity.id)
      if (i >= 0) this.queue[i] = { kind: 'activity', activity }
      else this.queue.push({ kind: 'activity', activity })
    })
  }

  /** A moderation update. Goes through the same chain so it can't overtake the message it refers to. */
  private enqueueModeration(action: ModerationEvent): void {
    this.chain = this.chain.then(() => {
      this.queue.push({ kind: 'moderation', action })
    })
  }

  /** Every 50 ms: send whatever has accumulated to the UI in one go. */
  private flush(): void {
    if (!this.queue.length || this.win.isDestroyed()) return
    this.win.webContents.send(IPC.batch, this.queue)
    this.queue = []
  }

  private sendStatus(platform: Platform, status: PlatformStatus): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.status, platform, status)
  }
}
