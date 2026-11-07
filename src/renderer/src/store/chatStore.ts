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
  type Platform,
  type PlatformStatus
} from '../../../shared/types'
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
  /** Which platforms are switched on (their top-bar chip is lit). */
  enabled: Record<Platform, boolean>
  /** The raw text typed in each platform's channel box, e.g. "mychannel, friend". */
  channels: Record<Platform, string>
  alwaysOnTop: boolean
  auth: AuthState
  /** Live polls and predictions in your channel (see ActivityPanel), by `activityKey`. */
  activities: Record<string, ChannelActivity>
  /** Whether event rows (subs, raids, mod notes...) are shown. */
  showEvents: boolean
  /** A short notice at the bottom of the feed, or undefined when there is none. */
  toast?: Toast

  /** Apply a batch from the main process: add new messages, apply deletions/timeouts, trim old ones. */
  addItems: (items: FeedItem[]) => void
  setStatus: (platform: Platform, status: PlatformStatus) => void
  togglePlatform: (platform: Platform) => void
  setChannels: (platform: Platform, raw: string) => void
  toggleAlwaysOnTop: () => void
  toggleEvents: () => void
  /** Close a poll/prediction card. It stays closed even if Twitch sends more updates for it. */
  dismissActivity: (key: string) => void
  clear: () => void
  setAuth: (auth: AuthState) => void
  showToast: (text: string, kind?: Toast['kind']) => void
}

/** Build `{ twitch: v, youtube: v, ... }` with the same value for every platform. */
const record = <T,>(value: T) => Object.fromEntries(PLATFORMS.map((p) => [p, value])) as Record<Platform, T>

/** localStorage key under which the typed channel names are saved between launches. */
const CHANNELS_KEY = 'hub.channels'

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
  enabled: record(false),
  channels: loadChannels(),
  alwaysOnTop: false,
  auth: { status: 'signed-out', configured: true },
  activities: {},
  showEvents: true,
  toast: undefined,

  // ---- actions ----
  addItems: (items) =>
    set((s) => {
      let messages = s.messages
      let activities = s.activities
      let pending: ChatMessage[] = [] // new messages not yet appended
      const commit = () => {
        if (pending.length) messages = messages.concat(pending)
        pending = []
      }
      // Process in order: a deletion must apply to a message that arrived earlier IN THE SAME batch,
      // so we append what we have before applying each moderation update.
      for (const item of items) {
        if (item.kind === 'message') {
          pending.push(item.message)
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
      return next
    }),

  setStatus: (platform, status) => set((s) => ({ status: { ...s.status, [platform]: status } })),

  togglePlatform: (platform) => {
    const enabled = !get().enabled[platform]
    set((s) => ({
      enabled: { ...s.enabled, [platform]: enabled },
      // Switching Twitch off stops poll updates, so an "active" card would never finish: clear them.
      ...(platform === 'twitch' && !enabled ? { activities: {} } : {})
    }))
    // Tell the main process to connect/disconnect, passing the cleaned channel list.
    void window.api.setPlatformEnabled(platform, enabled, parseSources(platform, get().channels[platform]))
  },

  setChannels: (platform, raw) => {
    const channels = { ...get().channels, [platform]: raw }
    set({ channels })
    try {
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels))
    } catch {
      /* storage unavailable: keep in memory only */
    }
    // If already connected, apply the change live.
    if (get().enabled[platform]) void window.api.setChannels(platform, parseSources(platform, raw))
  },

  toggleAlwaysOnTop: () => {
    const alwaysOnTop = !get().alwaysOnTop
    set({ alwaysOnTop })
    void window.api.setAlwaysOnTop(alwaysOnTop)
  },

  toggleEvents: () => set((s) => ({ showEvents: !s.showEvents })),

  clear: () => set({ messages: [] }),

  dismissActivity: (key) => {
    dismissedActivities.add(key)
    set((s) => {
      const { [key]: _gone, ...rest } = s.activities
      return { activities: rest }
    })
  },

  // Without the polls permission nothing can arrive, and a card left from before sign-out would be stale.
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
  return () => {
    offBatch()
    offStatus()
    offAuth()
  }
}
