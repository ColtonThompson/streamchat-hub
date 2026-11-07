/**
 * shared/types.ts
 *
 * WHAT: Every type and constant that is used by MORE THAN ONE of the app's three parts
 *       (main process, preload script, renderer/UI). If a piece of data crosses a boundary,
 *       its shape is defined here, so all three sides agree on it.
 *
 * HOW IT FITS: This file has no logic and imports nothing, so it is safe to import from anywhere.
 *       Read this file first: it is the vocabulary of the whole app.
 *
 * THE BIG IDEA: every platform (Twitch, YouTube, ...) is converted into the same `ChatMessage`
 *       shape by its "adapter" (src/main/adapters). The UI only ever sees `ChatMessage`, so it
 *       never needs to know which platform a message came from.
 *
 * CHANGE IT WHEN: you add a platform (extend `Platform`), a new kind of row (extend `EventType`),
 *       or a new button that talks to the main process (extend `HubApi` + `IPC`).
 */

// ============================================================================================
// Platforms and connection status
// ============================================================================================

/** Every platform the app knows about. Adding one here makes it appear in the top bar. */
export type Platform = 'twitch' | 'youtube' | 'kick' | 'x' | 'tiktok'

/** Same list as a runtime array (types vanish at runtime, so loops need a real array). */
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick', 'x', 'tiktok']

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** What the top-bar chip for a platform shows. `detail` is the tooltip text (e.g. "#mychannel"). */
export interface PlatformStatus {
  state: ConnectionState
  detail?: string
}

// ============================================================================================
// Chat messages
// ============================================================================================

/** A user badge (moderator, subscriber...). */
export interface Badge {
  /** Twitch's "set/version" form, e.g. "subscriber/12". Used to look up the image. */
  id: string
  /** Short text pill shown when there is no image; '' for badges we have no name for. */
  label: string
  /** Image URL, filled in later by BadgeService (needs a signed-in Twitch user). */
  url?: string
  /** Hover text, e.g. "12-Month Subscriber". */
  title?: string
}

/**
 * A message is a list of parts: plain text, emotes and links, in order.
 * The UI renders each part with its own component (see MessageRow.tsx `Part`).
 */
export type MessagePart =
  | { type: 'text'; value: string }
  | {
      type: 'emote'
      /** The word that was typed, e.g. "Kappa" (used for alt text and the tooltip). */
      value: string
      url: string
      /** Where the emote came from; shown in the tooltip. */
      source?: 'native' | '7tv' | 'bttv' | 'ffz' | 'youtube'
      /** Zero-width emotes (7TV/BTTV) that are drawn ON TOP of this one instead of beside it. */
      overlays?: { value: string; url: string }[]
    }
  | { type: 'link'; value: string; url: string }

/**
 * Kinds of special rows. Most are channel events shown as coloured "cards"; `moderation` and
 * `notice` are quiet one-line notes. Colours and labels live in renderer/src/lib/events.ts.
 */
export type EventType =
  | 'sub'
  | 'resub'
  | 'subgift'
  | 'giftbomb'
  | 'raid'
  | 'announcement'
  | 'milestone'
  | 'member' // a YouTube channel membership (new member or membership milestone)
  | 'poll' // a Twitch poll started or finished
  | 'prediction' // a Twitch prediction started, locked or finished
  | 'moderation'
  | 'notice'

/** Data for a channel-event row. A row with `event` set is drawn as an event, not a chat line. */
export interface ChatEvent {
  type: EventType
  /** Ready-to-show text, e.g. "pixelwitch subscribed at Tier 1." Empty for announcements. */
  title: string
  /** Overrides the default colour for this type (announcements carry their own colour). */
  color?: string
  /**
   * For `moderation` notices about a user (timeout/ban): who it was against.
   * The UI uses this to offer an "Undo" (unban) button.
   */
  target?: { userId?: string; login: string }
}

/** Why a message is shown as removed. Set by `applyModeration` (renderer/src/lib/moderation.ts). */
export type RemovedReason = 'deleted' | 'timeout' | 'ban'

/**
 * THE central type. Every platform adapter produces these.
 * A chat line, a subscription card and a "user was banned" note are all ChatMessages;
 * rows with `event` set are the special ones.
 */
export interface ChatMessage {
  /** Unique id. For Twitch this is Twitch's own message id (needed to delete the message). */
  id: string
  platform: Platform
  /** Which channel it came from. For Twitch: the channel login name, e.g. "summit1g". */
  channelId: string
  author: {
    /** The platform's user id (Twitch numeric id). Needed for timeouts and bans. */
    id?: string
    name: string
    color?: string
    badges: Badge[]
  }
  /** The message content. For events: the viewer's attached message, often empty. */
  parts: MessagePart[]
  /** Milliseconds since 1970 (Date.now() style). */
  timestamp: number
  /** Present when this row is an event rather than a normal chat line. */
  event?: ChatEvent
  /** Present when a moderator removed this message. Set later by the renderer. */
  removed?: RemovedReason
  meta?: {
    isSub?: boolean
    isMod?: boolean
    isAction?: boolean
    bits?: number
    /**
     * A YouTube Super Chat / Super Sticker. `label` is the amount exactly as YouTube shows it
     * ("$5.00", "CA$10.00", "¥500": currencies differ, so it is text, not a number). `color` is the
     * colour YouTube gave that tier ("#rrggbb"), used to tint the amount pill.
     */
    superChat?: { label: string; color?: string }
  }
}

// ============================================================================================
// Moderation: things that HAPPENED (from the platform) vs things you ASK FOR (from the UI)
// ============================================================================================

/**
 * Something a moderator did that changes messages we already have on screen.
 * Direction: platform -> main process -> UI. The UI applies it (renderer/src/lib/moderation.ts).
 */
export type ModerationEvent =
  | { type: 'delete-message'; platform: Platform; channelId: string; messageId: string }
  | { type: 'clear-user'; platform: Platform; channelId: string; userId?: string; login: string; durationSec?: number }

/**
 * Something YOU ask the app to do (the buttons on the hover toolbar).
 * Direction: UI -> main process -> platform API. Success is NOT applied locally: Twitch confirms
 * by sending back a ModerationEvent, which is what updates the screen.
 */
export type ModerationCommand =
  | { action: 'delete'; platform: Platform; channel: string; messageId: string }
  | { action: 'timeout'; platform: Platform; channel: string; userId: string; durationSec: number }
  | { action: 'ban'; platform: Platform; channel: string; userId: string }
  | { action: 'unban'; platform: Platform; channel: string; userId: string }

/** Outcome of a send or moderation request. `error` is written for the user to read. */
export interface ActionResult {
  ok: boolean
  error?: string
}

// ============================================================================================
// Polls and predictions (Twitch)
// ============================================================================================

/** One answer in a poll. */
export interface PollChoice {
  id: string
  title: string
  /** Total votes (Channel Points votes included). */
  votes: number
}

/** One side of a prediction. */
export interface PredictionOutcome {
  id: string
  title: string
  /** Twitch colours the two common outcomes "blue" and "pink". */
  color: string
  /** How many viewers predicted this outcome. */
  users: number
  /** Total Channel Points put on this outcome. */
  points: number
  /** The biggest bettors on this outcome (Twitch sends up to 10; we keep a few). `pointsWon` appears once resolved. */
  topPredictors: { name: string; pointsUsed: number; pointsWon?: number }[]
}

/**
 * A poll or prediction being run in YOUR channel. Unlike chat rows these are LIVE STATE: every update
 * replaces the previous one with the same `id`, and the UI shows the latest as a card above the feed
 * (renderer/src/components/ActivityPanel.tsx).
 * All times are milliseconds since 1970.
 */
export type ChannelActivity =
  | {
      kind: 'poll'
      id: string
      /** The channel login the poll belongs to (what chat rows call `channelId`). */
      channelId: string
      title: string
      choices: PollChoice[]
      /** `active` while voting; `completed` normally; `terminated` = the streamer ended it early; `archived` = removed. */
      status: 'active' | 'completed' | 'terminated' | 'archived'
      startedAt: number
      /** When voting closes (known while active). */
      endsAt?: number
      endedAt?: number
    }
  | {
      kind: 'prediction'
      id: string
      channelId: string
      title: string
      outcomes: PredictionOutcome[]
      /** `active` = viewers can still predict; `locked` = no more predictions, waiting for the result; then `resolved` or `canceled` (points refunded). */
      status: 'active' | 'locked' | 'resolved' | 'canceled'
      startedAt: number
      /** When predictions close (known while active). */
      locksAt?: number
      endedAt?: number
      winningOutcomeId?: string
    }

/**
 * What the main process pushes to the UI (in batches, see bus.ts):
 * a new row, a change to rows that are already on screen, or a new state of a live poll/prediction.
 */
export type FeedItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'moderation'; action: ModerationEvent }
  | { kind: 'activity'; activity: ChannelActivity }

// ============================================================================================
// Sign-in
// ============================================================================================

/** Extra permission groups to ask Twitch for when signing in. Anything already granted is kept. */
export interface LoginOptions {
  /** Delete messages, time out and ban (the mod toolbar). */
  moderation?: boolean
  /** Read the polls and predictions of your own channel. */
  polls?: boolean
}

export interface AuthState {
  status: 'signed-out' | 'pending' | 'signed-in'
  /** False when no Twitch client ID is set in .env (the UI then explains how to add one). */
  configured: boolean
  login?: string
  /** Twitch user id of the signed-in account (used to avoid showing mod buttons on yourself). */
  userId?: string
  /** True when the token includes the permissions needed to delete, time out and ban. */
  canModerate?: boolean
  /** True when the token includes the permissions needed to read your channel's polls and predictions. */
  canReadPolls?: boolean
  /** While `pending`: the code the user types in at twitch.tv/activate. */
  userCode?: string
  verificationUri?: string
  /** Last problem, shown under the sign-in button. */
  error?: string
}

// ============================================================================================
// The bridge between the UI and the main process
// ============================================================================================

/**
 * The two colours the native window frame needs: the strip behind the minimise/maximise/close buttons
 * (`background`) and the button icons themselves (`foreground`). Sent when the theme changes.
 * Both are "#rrggbb" strings.
 */
export interface WindowTheme {
  background: string
  foreground: string
}

/**
 * Everything the UI is allowed to ask of the main process. It is exposed as `window.api` by
 * src/preload/index.ts. The UI cannot touch Node or Electron directly (a security feature), so
 * anything needing the network, files or OS goes through this list.
 *
 * To add a capability: add it here, add its channel name to `IPC`, implement it in preload/index.ts,
 * and handle it in main/index.ts.
 */
/** Where the self-updater is. `disabled` = running from source (npm run dev), where there is nothing to update. */
export type UpdateState =
  | { status: 'disabled'; version: string }
  | { status: 'idle'; version: string; checkedAt?: number }
  | { status: 'checking'; version: string }
  | { status: 'none'; version: string; checkedAt: number }
  | { status: 'available'; version: string; next: string }
  | { status: 'downloading'; version: string; next: string; percent: number }
  | { status: 'ready'; version: string; next: string }
  | { status: 'error'; version: string; message: string }

export interface HubApi {
  /** Subscribe to new rows and changes. Returns an "unsubscribe" function. */
  onBatch(cb: (items: FeedItem[]) => void): () => void
  onStatus(cb: (platform: Platform, status: PlatformStatus) => void): () => void
  setPlatformEnabled(platform: Platform, enabled: boolean, channels: string[]): Promise<void>
  setChannels(platform: Platform, channels: string[]): Promise<void>
  setAlwaysOnTop(value: boolean): Promise<void>
  /** Recolour the native title-bar area to match the current theme. */
  setWindowTheme(theme: WindowTheme): Promise<void>
  sendChat(platform: Platform, channel: string, text: string): Promise<ActionResult>
  moderate(command: ModerationCommand): Promise<ActionResult>
  auth: {
    get(): Promise<AuthState>
    /** `options` asks for extra permission groups (mod toolbar, polls and predictions). */
    login(options?: LoginOptions): Promise<void>
    /** Stop waiting for the browser step but stay signed in if already signed in. */
    cancel(): Promise<void>
    logout(): Promise<void>
    onState(cb: (state: AuthState) => void): () => void
  }
  updates: {
    get(): Promise<UpdateState>
    /** Look for a new version now (it also checks by itself every few hours). */
    check(): Promise<void>
    /** Quit and install a downloaded update. Does nothing unless one is ready. */
    install(): Promise<void>
    onState(cb: (state: UpdateState) => void): () => void
  }
}

/**
 * Names of the messages sent between the UI and the main process (Electron calls these "IPC
 * channels"). Using constants instead of typing the strings twice avoids typo bugs.
 */
export const IPC = {
  batch: 'chat:batch',
  status: 'chat:status',
  toggle: 'adapter:toggle',
  channels: 'adapter:channels',
  onTop: 'window:always-on-top',
  windowTheme: 'window:theme',
  send: 'chat:send',
  moderate: 'chat:moderate',
  authGet: 'auth:get',
  authLogin: 'auth:login',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',
  authState: 'auth:state',
  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesState: 'updates:state'
} as const
