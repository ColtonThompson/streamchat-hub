/**
 * renderer/src/store/chatStore.ts   (the app's shared state)
 *
 * WHAT: One central store (using "Zustand") holding everything the UI shows: the messages, which
 *       platforms are on, connection status, typed channel names, sign-in state, and the toast.
 *
 * HOW ZUSTAND WORKS, in brief:
 *   - `useChatStore((s) => s.something)` inside a component reads one piece of state and re-renders
 *     that component when ONLY that piece changes. Always select the smallest piece you need.
 *   - Functions defined in the store (like `addItems`) change state via `set(...)`.
 *   - Never modify state in place; always produce new objects/arrays (`{...old, changed}`), because
 *     React detects changes by comparing references.
 *
 * DATA FLOW: main process -> window.api.onBatch -> `addItems` -> `messages` -> ChatFeed re-renders.
 *
 * CHANGE IT WHEN: you add a setting or piece of UI state. Add the field to `ChatState`, give it an
 *   initial value in `create(...)`, and (if it changes) add an action to update it.
 */
import { create } from 'zustand'
import { parseSources } from '../../../shared/channels'
import {
  PLATFORMS,
  type AuthState,
  type ChannelActivity,
  type ChatMessage,
  type FeedItem,
  type PinnedMessage,
  type Platform,
  type PlatformStatus
} from '../../../shared/types'
import { channelBreaks } from '../lib/channelbreaks'
import { chatterKey, chatterUpdate, MAX_CHATTERS, type Chatter } from '../lib/chatters'
import { allChannels, channelKey, type ChannelRef } from '../lib/streaminfo'
import { applyModeration } from '../lib/moderation'

/** The most messages kept in memory; older ones are dropped. Keeps the app fast in marathon streams. */
const MAX_MESSAGES = 2000

/** Finished polls/predictions older than this are forgotten (the card itself hides sooner; see lib/activity.ts). */
const ACTIVITY_KEEP_MS = 10 * 60_000

/** The key a poll or prediction is stored under. A poll and a prediction could share an id, so the kind is part of it. */
export const activityKey = (a: ChannelActivity) => `${a.kind}:${a.id}`

/**
 * Cards the user closed. Later updates for the same poll (a vote arriving) must not bring the card
 * back, so we remember them. Lives outside the store because nothing needs to re-render when it changes.
 */
const dismissedActivities = new Set<string>()
/** Pins the user closed (`pinKey|messageId`): a pin stays closed, but a NEW pin in the same channel shows again. */
const dismissedPins = new Set<string>()

/** The key a channel's pin is stored under. */
export const pinKey = (platform: Platform, channelId: string) => `${platform}:${channelId}`

/** How long a toast notice stays on screen. */
const TOAST_MS = 5000

export interface Toast {
  text: string
  kind: 'info' | 'error'
}

interface ChatState {
  /** Every row in the feed, oldest first (chat lines, events, notes). */
  messages: ChatMessage[]
  status: Record<Platform, PlatformStatus>
  /** Which platforms are connected. Not a switch: a platform is on exactly when it has at least one channel (see `setChannels`). */
  enabled: Record<Platform, boolean>
  /** The channels of each platform as saved text (written by Add channel / removeChannel), e.g. "mychannel, friend". */
  channels: Record<Platform, string>
  /** Which channel's title and viewer count the bar above the chat shows (`channelKey`), when several are read. */
  titleSource: string
  /** Everyone who has chatted this session, by `chatterKey` (see lib/chatters.ts). Kept apart from `messages` so it is not lost as old messages are trimmed. */
  chatters: Map<string, Chatter>
  /** Is the chatters list (ChattersPanel) open? Remembered between launches. */
  chattersOpen: boolean
  /** Platforms whose section in the chatters list is collapsed. Remembered between launches. */
  chattersCollapsed: Platform[]
  alwaysOnTop: boolean
  auth: AuthState
  /** Live polls and predictions in your channel (see ActivityPanel), by `activityKey`. */
  activities: Record<string, ChannelActivity>
  /** The message each channel has pinned (see PinnedBar), by `pinKey`. */
  pins: Record<string, PinnedMessage>
  /** Whether event rows (subs, raids, mod notes...) are shown. */
  showEvents: boolean
  /** A short notice at the bottom of the feed, or undefined when there is none. */
  toast?: Toast

  /** Apply a batch from the main process: add new messages, apply deletions/timeouts, trim old ones. */
  addItems: (items: FeedItem[]) => void
  setStatus: (platform: Platform, status: PlatformStatus) => void
  /** At startup: reconnect every platform that still has channels from the last session. */
  resume: () => void
  setChannels: (platform: Platform, raw: string) => void
  /**
   * Join one or more channels (a Twitch name, or a YouTube @handle / stream link) from the "Add channel" window.
   * Switches the platform on if it is off. `added` lists what was actually new; an error says why nothing was added.
   */
  addChannel: (platform: Platform, input: string) => { ok: true; added: string[] } | { ok: false; error: string }
  /** Leave one channel (as `parseSources` writes it). */
  removeChannel: (platform: Platform, source: string) => void
  /** Choose which channel's title the bar above the chat follows (a `channelKey`). */
  setTitleSource: (key: string) => void
  toggleAlwaysOnTop: () => void
  toggleEvents: () => void
  toggleChatters: () => void
  /** Collapse or expand one platform's section of the chatters list. */
  toggleChattersPlatform: (platform: Platform) => void
  /** Close a poll/prediction card. It stays closed even if Twitch sends more updates for it. */
  dismissActivity: (key: string) => void
  /** Close a pinned-message bar until that channel pins something different. */
  dismissPin: (key: string) => void
  clear: () => void
  setAuth: (auth: AuthState) => void
  showToast: (text: string, kind?: Toast['kind']) => void
}

/** Build `{ twitch: v, youtube: v, ... }` with the same value for every platform. */
const record = <T,>(value: T) => Object.fromEntries(PLATFORMS.map((p) => [p, value])) as Record<Platform, T>

/** localStorage key under which the typed channel names are saved between launches. */
const CHANNELS_KEY = 'hub.channels'
/** ...and the channel whose title is shown. */
const TITLE_KEY = 'hub.titleSource'
/** ...and whether the chatters list is open. */
const CHATTERS_KEY = 'hub.chattersOpen'

/** ...and which platforms' sections are collapsed. */
const COLLAPSED_KEY = 'hub.chattersCollapsed'

function loadChattersCollapsed(): Platform[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((p): p is Platform => PLATFORMS.includes(p)) : []
  } catch {
    return []
  }
}

function loadChattersOpen(): boolean {
  try {
    return localStorage.getItem(CHATTERS_KEY) === '1'
  } catch {
    return false
  }
}

function loadTitleSource(): string {
  try {
    return localStorage.getItem(TITLE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** A platform is on exactly when it has channels to read. Only Twitch and YouTube have real adapters. */
function platformsWithChannels(channels: Record<Platform, string>): Record<Platform, boolean> {
  return Object.fromEntries(PLATFORMS.map((p) => [p, (p === 'twitch' || p === 'youtube') && parseSources(p, channels[p]).length > 0])) as Record<Platform, boolean>
}

function loadChannels(): Record<Platform, string> {
  const base = record('')
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(CHANNELS_KEY) ?? '{}') }
  } catch {
    return base // corrupted or unavailable storage: start empty
  }
}

/** Drop finished polls/predictions that are long over. Returns the same object when nothing was dropped. */
function pruneActivities(activities: Record<string, ChannelActivity>): Record<string, ChannelActivity> {
  const cutoff = Date.now() - ACTIVITY_KEEP_MS
  const keep = Object.entries(activities).filter(([, a]) => !a.endedAt || a.endedAt > cutoff)
  return keep.length === Object.keys(activities).length ? activities : Object.fromEntries(keep)
}

/** Timer for the current toast, so a new toast can cancel the old one's expiry. */
let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useChatStore = create<ChatState>((set, get) => ({
  // ---- initial state ----
  messages: [],
  status: record<PlatformStatus>({ state: 'disconnected' }),
  // Resuming last session: a platform with saved channels starts "on"; `resume()` (called once at startup) connects it.
  enabled: platformsWithChannels(loadChannels()),
  channels: loadChannels(),
  titleSource: loadTitleSource(),
  chatters: new Map(),
  chattersOpen: loadChattersOpen(),
  chattersCollapsed: loadChattersCollapsed(),
  alwaysOnTop: false,
  auth: { status: 'signed-out', configured: true },
  activities: {},
  pins: {},
  showEvents: true,
  toast: undefined,

  // ---- actions ----
  addItems: (items) =>
    set((s) => {
      let messages = s.messages
      let activities = s.activities
      let pins = s.pins
      let chatters = s.chatters
      let pending: ChatMessage[] = [] // new messages not yet appended
      // A message id is only ever shown once, whatever path it arrived by (a repeated notification, a reconnect
      // replaying history). Built on first use, because most batches have nothing to check.
      let known: Set<string> | undefined
      const commit = () => {
        if (pending.length) messages = messages.concat(pending)
        pending = []
      }
      // Process in order: a deletion must apply to a message that arrived earlier IN THE SAME batch,
      // so we append what we have before applying each moderation update.
      for (const item of items) {
        if (item.kind === 'message') {
          known ??= new Set(messages.map((m) => m.id))
          if (known.has(item.message.id)) continue
          known.add(item.message.id)
          pending.push(item.message)
          // Remember who chatted, and their role (a new Map only when something changed, so React sees it).
          const key = chatterKey(item.message)
          const updated = chatterUpdate(chatters.get(key), item.message)
          if (updated) {
            if (chatters === s.chatters) chatters = new Map(chatters)
            chatters.set(key, updated)
          }
        } else if (item.kind === 'pin') {
          const key = pinKey(item.pin.platform, item.pin.channelId)
          if (!dismissedPins.has(`${key}|${item.pin.messageId}`)) pins = { ...pins, [key]: item.pin }
        } else if (item.kind === 'unpin') {
          const key = pinKey(item.platform, item.channelId)
          if (key in pins) {
            const { [key]: _gone, ...rest } = pins
            pins = rest
          }
        } else if (item.kind === 'activity') {
          // Live state: the newest update for a poll/prediction replaces the older one.
          const key = activityKey(item.activity)
          if (!dismissedActivities.has(key)) activities = { ...activities, [key]: item.activity }
        } else {
          commit()
          messages = applyModeration(messages, item.action)
        }
      }
      commit()
      const next: Partial<ChatState> = {
        messages: messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages
      }
      if (activities !== s.activities) next.activities = pruneActivities(activities)
      if (pins !== s.pins) next.pins = pins
      if (chatters !== s.chatters) {
        // Forget the chatters seen first once there are too many (a Map keeps the order they were added in).
        for (const key of chatters.keys()) {
          if (chatters.size <= MAX_CHATTERS) break
          chatters.delete(key)
        }
        next.chatters = chatters
      }
      return next
    }),

  setStatus: (platform, status) => set((s) => ({ status: { ...s.status, [platform]: status } })),

  resume: () => {
    const { enabled, channels } = get()
    for (const p of PLATFORMS) if (enabled[p]) void window.api.setPlatformEnabled(p, true, parseSources(p, channels[p]))
  },

  setChannels: (platform, raw) => {
    const before = parseSources(platform, get().channels[platform])
    const after = parseSources(platform, raw)
    const channels = { ...get().channels, [platform]: raw }
    set({ channels })
    try {
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels))
    } catch {
      /* storage unavailable: keep in memory only */
    }
    // A platform is connected exactly while it has channels: the first one connects it, removing the last disconnects it.
    const wasOn = get().enabled[platform]
    const isOn = after.length > 0
    if (isOn !== wasOn) {
      set((s) => ({
        enabled: { ...s.enabled, [platform]: isOn },
        // Twitch stops reporting polls, and any platform its pins, once it is disconnected, so drop what would go stale.
        ...(!isOn && platform === 'twitch' ? { activities: {} } : {}),
        ...(!isOn ? { pins: Object.fromEntries(Object.entries(s.pins).filter(([, p]) => p.platform !== platform)) } : {})
      }))
      void window.api.setPlatformEnabled(platform, isOn, after)
    } else if (isOn) {
      void window.api.setChannels(platform, after) // already connected: apply the change live
    }
    // Mark in the feed where a chat joined or left (only a connected platform really joins or leaves).
    if (wasOn || isOn) {
      const breaks = channelBreaks(platform, before, after)
      if (breaks.length) set((s) => ({ messages: s.messages.concat(breaks) }))
    }
  },

  addChannel: (platform, input) => {
    const wanted = parseSources(platform, input)
    if (!wanted.length) {
      return {
        ok: false,
        error:
          platform === 'youtube'
            ? 'That is not a YouTube @handle, stream link or video id. Handles need the @.'
            : 'That is not a Twitch channel name. Use letters, numbers and underscores, or paste a twitch.tv link.'
      }
    }
    const current = parseSources(platform, get().channels[platform])
    const added = wanted.filter((c) => !current.includes(c))
    if (!added.length) return { ok: false, error: wanted.length > 1 ? 'Those are already in your feed.' : 'That channel is already in your feed.' }
    const next = [...current, ...added]
    if (parseSources(platform, next.join(', ')).length < next.length) {
      return { ok: false, error: `You can read at most ${platform === 'youtube' ? 5 : 20} ${platform === 'youtube' ? 'YouTube streams' : 'Twitch channels'} at once. Remove one first.` }
    }
    // The first channel you add is the one whose title is shown (you can pick another from the Channels menu).
    if (!allChannels(get().channels).length) get().setTitleSource(channelKey({ platform: platform as ChannelRef['platform'], source: added[0] }))
    get().setChannels(platform, next.join(', ')) // connects the platform if this is its first channel, and marks the join
    return { ok: true, added }
  },

  removeChannel: (platform, source) => {
    const current = parseSources(platform, get().channels[platform])
    if (!current.includes(source)) return
    get().setChannels(platform, current.filter((c) => c !== source).join(', '))
  },

  setTitleSource: (key) => {
    set({ titleSource: key })
    try {
      localStorage.setItem(TITLE_KEY, key)
    } catch {
      /* storage unavailable: it just resets next launch */
    }
  },

  toggleAlwaysOnTop: () => {
    const alwaysOnTop = !get().alwaysOnTop
    set({ alwaysOnTop })
    void window.api.setAlwaysOnTop(alwaysOnTop)
  },

  toggleEvents: () => set((s) => ({ showEvents: !s.showEvents })),

  toggleChatters: () => {
    const chattersOpen = !get().chattersOpen
    set({ chattersOpen })
    try {
      localStorage.setItem(CHATTERS_KEY, chattersOpen ? '1' : '0')
    } catch {
      /* storage unavailable: it just resets next launch */
    }
  },

  toggleChattersPlatform: (platform) => {
    const now = get().chattersCollapsed
    const chattersCollapsed = now.includes(platform) ? now.filter((p) => p !== platform) : [...now, platform]
    set({ chattersCollapsed })
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(chattersCollapsed))
    } catch {
      /* storage unavailable: it just resets next launch */
    }
  },

  clear: () => set({ messages: [], chatters: new Map() }),

  dismissActivity: (key) => {
    dismissedActivities.add(key)
    set((s) => {
      const { [key]: _gone, ...rest } = s.activities
      return { activities: rest }
    })
  },

  // Without the polls permission nothing can arrive, and a card left from before sign-out would be stale.
  dismissPin: (key) => {
    const pin = get().pins[key]
    if (pin) dismissedPins.add(`${key}|${pin.messageId}`)
    set((s) => {
      const { [key]: _gone, ...rest } = s.pins
      return { pins: rest }
    })
  },

  setAuth: (auth) => set((s) => ({ auth, activities: auth.status === 'signed-in' && auth.canReadPolls ? s.activities : {} })),

  showToast: (text, kind = 'info') => {
    clearTimeout(toastTimer)
    set({ toast: { text, kind } })
    toastTimer = setTimeout(() => set({ toast: undefined }), TOAST_MS)
  }
}))

/**
 * Connect the store to the main process. Call once at startup (App.tsx does).
 * Returns a function that removes all the listeners again.
 */
export function subscribeToMain(): () => void {
  const offBatch = window.api.onBatch((items) => useChatStore.getState().addItems(items))
  const offStatus = window.api.onStatus((p, s) => useChatStore.getState().setStatus(p, s))
  const offAuth = window.api.auth.onState((a) => useChatStore.getState().setAuth(a))
  // The sign-in state may already be known by the time the UI loads, so ask for it once.
  void window.api.auth.get().then((a) => useChatStore.getState().setAuth(a))
  // Coming back from the browser after approving a sign-in: ask again, so the page shows the new permissions even if a
  // push was missed.
  const refreshAuth = () => void window.api.auth.get().then((a) => useChatStore.getState().setAuth(a))
  window.addEventListener('focus', refreshAuth)
  return () => {
    offBatch()
    offStatus()
    offAuth()
    window.removeEventListener('focus', refreshAuth)
  }
}
