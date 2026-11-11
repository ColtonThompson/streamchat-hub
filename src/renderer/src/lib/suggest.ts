/**
 * renderer/src/lib/suggest.ts   (channel suggestions for the Twitch box; no React, easy to test)
 *
 * The box holds a list like "foo, bar baz". The suggestions work on the ONE entry the cursor is in:
 *   tokenAt(draft, caret)           which entry is being typed (its start/end/text)
 *   suggest(live, draft, caret)     live channels matching it, best first (never ones already listed)
 *   applySuggestion(draft, ...)     the text after choosing one, and where the cursor goes
 *
 * Ranking: names that START with what you typed come first, then names that merely contain it;
 * within each group the channel with the most viewers comes first. Both the login ("pixelwitch") and
 * the display name ("PixelWitch", which can differ in spelling for some languages) are matched.
 */
import { parseChannels } from '../../../shared/channels'
import type { LiveChannel } from '../../../shared/types'

export interface Token {
  start: number
  end: number
  text: string
}

const SEPARATOR = /[\s,]/

/** The entry (run of non-separator characters) containing the cursor; empty when the cursor is between entries. */
export function tokenAt(draft: string, caret: number): Token {
  const c = Math.max(0, Math.min(caret, draft.length))
  let start = c
  while (start > 0 && !SEPARATOR.test(draft[start - 1])) start--
  let end = c
  while (end < draft.length && !SEPARATOR.test(draft[end])) end++
  return { start, end, text: draft.slice(start, end) }
}

export const MAX_SUGGESTIONS = 30

/** Live channels to offer for the entry at the cursor, best first. */
export function suggest(live: LiveChannel[], draft: string, caret: number, limit = MAX_SUGGESTIONS): LiveChannel[] {
  const tok = tokenAt(draft, caret)
  const q = tok.text.toLowerCase().replace(/^#/, '')
  // Channels already in the box (every OTHER entry) are not offered again.
  const taken = new Set(parseChannels(draft.slice(0, tok.start) + ' ' + draft.slice(tok.end)))

  const ranked: { c: LiveChannel; rank: number }[] = []
  for (const c of live) {
    if (taken.has(c.login)) continue
    if (!q) {
      ranked.push({ c, rank: 0 })
      continue
    }
    const login = c.login.toLowerCase()
    const name = c.name.toLowerCase()
    if (login === q) continue // already exactly this: nothing to complete
    if (login.startsWith(q) || name.startsWith(q)) ranked.push({ c, rank: 0 })
    else if (login.includes(q) || name.includes(q)) ranked.push({ c, rank: 1 })
  }
  ranked.sort((a, b) => a.rank - b.rank || b.c.viewers - a.c.viewers || a.c.login.localeCompare(b.c.login))
  return ranked.slice(0, limit).map((r) => r.c)
}

/** Replace the entry at the cursor with `login`. At the end of the text a ", " is added so you can keep typing. */
export function applySuggestion(draft: string, caret: number, login: string): { draft: string; caret: number } {
  const tok = tokenAt(draft, caret)
  const atEnd = tok.end === draft.length
  const insert = atEnd ? `${login}, ` : login
  return { draft: draft.slice(0, tok.start) + insert + draft.slice(tok.end), caret: tok.start + insert.length }
}

// ============================================================================================
// The checklist shown under the Twitch box
// ============================================================================================

/** One row of the checklist. Checked rows are the channels already in the box; unchecked ones are live channels you follow. */
export interface ChecklistRow {
  login: string
  name: string
  game: string
  viewers: number
  /** Is the channel live right now? (Only known for channels you follow, with the go-live permission.) */
  live: boolean
  checked: boolean
}

/**
 * The rows to show: first the channels in the box (checked, in the order typed), then the other live channels you
 * follow (unchecked, most viewers first).
 *
 * `typing` is true while the user is in the middle of typing an entry. Then the entry at the cursor is only a
 * partial name: it is NOT counted as in the box, and it filters the list. Otherwise (the list was opened by click or
 * button) everything in the box counts and nothing filters.
 */
export function buildChecklist(live: LiveChannel[], draft: string, caret: number, typing: boolean): ChecklistRow[] {
  const tok = tokenAt(draft, caret)
  const selected = parseChannels(typing ? draft.slice(0, tok.start) + ' ' + draft.slice(tok.end) : draft)
  const q = typing ? tok.text.toLowerCase().replace(/^#/, '') : ''

  const checked: ChecklistRow[] = []
  for (const login of selected) {
    const l = live.find((x) => x.login === login)
    const name = l?.name ?? login
    if (q && !login.includes(q) && !name.toLowerCase().includes(q)) continue
    checked.push({ login, name, game: l?.game ?? '', viewers: l?.viewers ?? 0, live: !!l, checked: true })
  }

  // The remaining live channels: `suggest` already leaves out everything in the box and ranks by the filter.
  const base = draft.replace(/[\s,]+$/, '')
  const view = typing ? { text: draft, caret } : { text: base ? `${base}, ` : '', caret: base ? base.length + 2 : 0 }
  const others = suggest(live, view.text, view.caret).map((c) => ({ login: c.login, name: c.name, game: c.game, viewers: c.viewers, live: true, checked: false }))
  return [...checked, ...others]
}

/**
 * Click on a row: add the channel if it is not in the box, remove it if it is. Returns the new text and cursor.
 * Adding while typing replaces the partial entry; otherwise it is appended. Removing tidies the text to a clean list.
 */
export function toggleChannel(draft: string, caret: number, login: string, typing: boolean): { draft: string; caret: number } {
  const tok = tokenAt(draft, caret)
  const selected = parseChannels(typing ? draft.slice(0, tok.start) + ' ' + draft.slice(tok.end) : draft)
  if (selected.includes(login)) {
    const rest = parseChannels(draft).filter((l) => l !== login)
    const next = rest.length ? `${rest.join(', ')}, ` : ''
    return { draft: next, caret: next.length }
  }
  if (typing) return applySuggestion(draft, caret, login)
  const base = draft.replace(/[\s,]+$/, '')
  const next = base ? `${base}, ${login}, ` : `${login}, `
  return { draft: next, caret: next.length }
}
