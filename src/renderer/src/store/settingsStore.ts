/**
 * renderer/src/store/settingsStore.ts   (the user's preferences + the settings panel's state)
 *
 * WHAT: A second Zustand store (see chatStore.ts for how Zustand works). chatStore holds the live
 *       chat; this one holds choices the USER made, plus whether the settings panel is open.
 *
 * TWO KINDS OF STATE
 *   1. SAVED settings: theme, timestamps, blacklist. Defined in lib/settings.ts (`Settings`), written
 *      to localStorage on every change and read back (through `sanitizeSettings`) at startup.
 *   2. SCREEN-ONLY state: `resolvedTheme`, `panelOpen`, `tab`. Never saved.
 *
 * `theme` is what the user PICKED (it may be 'system'); `resolvedTheme` is the theme actually in use
 * (never 'system'). store/themeSync.ts keeps `resolvedTheme` up to date; ChatFeed reads it to pass the
 * background colour to rows so usernames stay readable.
 *
 * TO ADD A SETTING: add it to `Settings` + `DEFAULT_SETTINGS` + `sanitizeSettings` (lib/settings.ts),
 * add a setter below, and put a control in a tab under components/settings/. Saving is automatic: the
 * `subscribe` call at the bottom persists any change to the saved fields.
 */
import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  MAX_BLACKLIST_TERMS,
  MAX_TERM_LENGTH,
  normalizeTerm,
  pickSettings,
  sanitizeSettings,
  type Settings,
  type TimestampMode
} from '../lib/settings'
import { applyZoomAction, clampZoom, type ZoomAction } from '../../../shared/zoom'
import { resolveTheme, type ThemeChoice, type ThemeId } from '../lib/themes'

export type SettingsTab = 'appearance' | 'chat' | 'accounts' | 'about'

/** Why a blacklist term was or wasn't added; ChatTab turns each into a message. */
export type AddTermResult = 'added' | 'empty' | 'duplicate' | 'too-long' | 'full'

/** localStorage key. If the saved shape ever changes incompatibly, bump it (e.g. 'hub.settings.v2'). */
const STORAGE_KEY = 'hub.settings'

/** Read saved settings. Anything missing, corrupt or invalid falls back to its default. */
function load(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_SETTINGS, blacklist: [] } // unreadable JSON or storage unavailable
  }
}

interface SettingsState extends Settings {
  /** The theme in use right now: `theme`, or whichever of dark/light 'system' resolved to. */
  resolvedTheme: ThemeId
  panelOpen: boolean
  tab: SettingsTab

  setTheme: (theme: ThemeChoice) => void
  setResolvedTheme: (id: ThemeId) => void
  setTimestamps: (mode: TimestampMode) => void
  setTimestampSeconds: (on: boolean) => void
  setLiveAlerts: (on: boolean) => void
  setShowStreamInfo: (on: boolean) => void
  /** Set the chat text size (percent); out-of-range values are clamped. */
  setChatZoom: (percent: number) => void
  /** Step the chat text size bigger/smaller, or back to 100%. */
  zoom: (action: ZoomAction) => void
  /** Add a term to the blacklist. Duplicates are detected ignoring case. */
  addBlacklistTerm: (raw: string) => AddTermResult
  removeBlacklistTerm: (term: string) => void
  clearBlacklist: () => void
  /** Open the panel, optionally jumping to a tab; with no argument it reopens on the last-used tab. */
  openPanel: (tab?: SettingsTab) => void
  closePanel: () => void
  setTab: (tab: SettingsTab) => void
}

const initial = load()
const systemPrefersDark = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  // Best guess until themeSync.initTheme() applies the real theme (it runs before the first paint).
  resolvedTheme: resolveTheme(initial.theme, systemPrefersDark),
  panelOpen: false,
  tab: 'appearance',

  setTheme: (theme) => set({ theme }),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  setTimestamps: (timestamps) => set({ timestamps }),
  setTimestampSeconds: (timestampSeconds) => set({ timestampSeconds }),
  setLiveAlerts: (liveAlerts) => set({ liveAlerts }),
  setShowStreamInfo: (showStreamInfo) => set({ showStreamInfo }),
  setChatZoom: (percent) => set({ chatZoom: clampZoom(percent) }),
  zoom: (action) => set((s) => ({ chatZoom: applyZoomAction(s.chatZoom, action) })),

  addBlacklistTerm: (raw) => {
    const term = normalizeTerm(raw)
    const { blacklist } = get()
    if (!term) return 'empty'
    if (term.length > MAX_TERM_LENGTH) return 'too-long'
    if (blacklist.some((t) => t.toLowerCase() === term.toLowerCase())) return 'duplicate'
    if (blacklist.length >= MAX_BLACKLIST_TERMS) return 'full'
    set({ blacklist: [...blacklist, term] }) // a NEW array: state is never modified in place
    return 'added'
  },
  removeBlacklistTerm: (term) => set((s) => ({ blacklist: s.blacklist.filter((t) => t !== term) })),
  clearBlacklist: () => set({ blacklist: [] }),

  openPanel: (tab) => set((s) => ({ panelOpen: true, tab: tab ?? s.tab })),
  closePanel: () => set({ panelOpen: false }),
  setTab: (tab) => set({ tab })
}))

/** Save whenever a saved field changes, and ONLY then (opening the panel must not write to disk). */
useSettingsStore.subscribe((state, prev) => {
  const a = pickSettings(state)
  const b = pickSettings(prev)
  if (a.theme === b.theme && a.timestamps === b.timestamps && a.timestampSeconds === b.timestampSeconds && a.blacklist === b.blacklist && a.liveAlerts === b.liveAlerts && a.chatZoom === b.chatZoom && a.showStreamInfo === b.showStreamInfo) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  } catch {
    /* storage unavailable or full: settings still work this session, they just won't be remembered */
  }
})
