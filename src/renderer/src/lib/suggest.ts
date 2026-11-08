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
