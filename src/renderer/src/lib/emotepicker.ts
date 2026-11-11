/**
 * renderer/src/lib/emotepicker.ts   (pure helpers for the emote picker; no React)
 *
 * WHAT: Two small jobs the picker (components/EmotePicker.tsx) needs:
 *   - `filterGroups`   keep only emotes whose name contains the search text (ignoring case), dropping empty sections
 *   - `insertEmote`    put an emote's name into the message box at the cursor, with a space around it, within the
 *                      500-character limit, and say where the cursor should go afterwards
 */
import type { EmoteGroup } from '../../../shared/types'

export function filterGroups(groups: EmoteGroup[], query: string): EmoteGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups.map((g) => ({ ...g, emotes: g.emotes.filter((e) => e.name.toLowerCase().includes(q)) })).filter((g) => g.emotes.length > 0)
}

/**
 * "hello|" + Kappa -> "hello Kappa |"; "|" + Kappa -> "Kappa |". Replaces the selection if there is one.
 * Returns undefined when the result would not fit in `max` characters (the caller leaves the text alone).
 */
export function insertEmote(text: string, start: number, end: number, name: string, max = 500): { text: string; cursor: number } | undefined {
  const s = Math.max(0, Math.min(start, text.length))
  const e = Math.max(s, Math.min(end, text.length))
  const before = text.slice(0, s)
  const after = text.slice(e)
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = after.length > 0 && /^\s/.test(after) ? '' : ' '
  const insert = `${lead}${name}${trail}`
  const next = before + insert + after
  if (next.length > max) return undefined
  return { text: next, cursor: before.length + insert.length + (trail === '' ? 1 : 0) }
}
