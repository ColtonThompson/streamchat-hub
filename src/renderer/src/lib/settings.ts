/**
 * renderer/src/lib/settings.ts
 *
 * WHAT: The shape of the user's saved settings, their defaults, and `sanitizeSettings`, which turns
 *       whatever was found in storage into a valid `Settings` object.
 *
 * WHY SANITIZE: Settings live in localStorage as plain JSON. That data may be from an older version of
 *   the app, hand-edited, or corrupted. Instead of trusting it, `sanitizeSettings` accepts only values
 *   that make sense and falls back to defaults for the rest, so a bad file can never crash the app.
 *
 * HOW IT FITS: store/settingsStore.ts loads and saves through these functions. This file is free of
 *   React and Zustand so it can be tested on its own.
 *
 * TO ADD A SETTING: add the field to `Settings` and `DEFAULT_SETTINGS`, validate it in
 *   `sanitizeSettings`, add an action in settingsStore.ts, and put a control in a Settings tab.
 */
import { clampZoom, ZOOM_DEFAULT } from '../../../shared/zoom'
import { THEMES, type ThemeChoice } from './themes'

export type TimestampMode = 'off' | '12h' | '24h'

export interface Settings {
  theme: ThemeChoice
  /** Show a time before each message? */
  timestamps: TimestampMode
  timestampSeconds: boolean
  /** Messages containing any of these (case-insensitive) are hidden. */
  blacklist: string[]
  /** Desktop notification when a followed channel goes live (Twitch). */
  liveAlerts: boolean
  /** Chat text size as a percentage (100 = normal). See shared/zoom.ts. */
  chatZoom: number
  /** Show the stream's title and viewer count above the chat when reading a single stream. */
  showStreamInfo: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'plum',
  timestamps: 'off',
  timestampSeconds: false,
  blacklist: [],
  liveAlerts: true,
  chatZoom: ZOOM_DEFAULT,
  showStreamInfo: true
}

export const MAX_BLACKLIST_TERMS = 200
export const MAX_TERM_LENGTH = 100

/** Trim and collapse repeated whitespace: "  free   followers " -> "free followers". */
export function normalizeTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

const TIMESTAMP_MODES: TimestampMode[] = ['off', '12h', '24h']

/** Turn anything (including garbage) into valid settings. Never throws. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  // `Object.hasOwn` (not `in`) so odd values like "toString" or "__proto__" aren't mistaken for theme ids.
  const theme: ThemeChoice =
    r.theme === 'system' || (typeof r.theme === 'string' && Object.hasOwn(THEMES, r.theme))
      ? (r.theme as ThemeChoice)
      : DEFAULT_SETTINGS.theme

  const timestamps = TIMESTAMP_MODES.includes(r.timestamps as TimestampMode) ? (r.timestamps as TimestampMode) : DEFAULT_SETTINGS.timestamps
  const timestampSeconds = typeof r.timestampSeconds === 'boolean' ? r.timestampSeconds : DEFAULT_SETTINGS.timestampSeconds

  const seen = new Set<string>() // lower-cased terms already kept, to drop duplicates
  const blacklist: string[] = []
  if (Array.isArray(r.blacklist)) {
    for (const item of r.blacklist) {
      if (typeof item !== 'string') continue
      const term = normalizeTerm(item)
      const key = term.toLowerCase()
      if (!term || term.length > MAX_TERM_LENGTH || seen.has(key)) continue
      seen.add(key)
      blacklist.push(term)
      if (blacklist.length >= MAX_BLACKLIST_TERMS) break
    }
  }
  const liveAlerts = typeof r.liveAlerts === 'boolean' ? r.liveAlerts : DEFAULT_SETTINGS.liveAlerts
  const chatZoom = typeof r.chatZoom === 'number' ? clampZoom(r.chatZoom) : DEFAULT_SETTINGS.chatZoom
  const showStreamInfo = typeof r.showStreamInfo === 'boolean' ? r.showStreamInfo : DEFAULT_SETTINGS.showStreamInfo
  return { theme, timestamps, timestampSeconds, blacklist, liveAlerts, chatZoom, showStreamInfo }
}

/** The fields that get saved (everything in `Settings`, nothing else from the store). */
export function pickSettings(s: Settings): Settings {
  return { theme: s.theme, timestamps: s.timestamps, timestampSeconds: s.timestampSeconds, blacklist: s.blacklist, liveAlerts: s.liveAlerts, chatZoom: s.chatZoom, showStreamInfo: s.showStreamInfo }
}
