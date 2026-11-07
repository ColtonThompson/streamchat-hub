/**
 * renderer/src/lib/blacklist.ts
 *
 * WHAT: Decides whether a chat message should be hidden because it contains a blacklisted term.
 *
 * RULES
 *   - Case-insensitive: the term "spam" also hides "SPAM" and "Spam".
 *   - "Contains": the term can appear anywhere, even inside a word ("cat" matches "category").
 *     Use a longer phrase if that is too broad.
 *   - What is searched: the words typed (text), emote names, and link text. Not the username.
 *   - Only ordinary chat lines are filtered. Events (subs, raids), moderation notes and
 *     announcements are never hidden by the blacklist.
 *   - Runs of spaces are treated as one, so "free followers" also matches "free   followers".
 *
 * HOW IT FITS: ChatFeed builds a matcher with `compileBlacklist(terms)` whenever the list changes and
 *   skips any message it flags. Hidden messages stay in memory (so removing a term brings them back).
 *
 * PERFORMANCE: the feed re-checks every message each time a batch arrives, so a message's lower-cased
 *   text is computed once and remembered (a WeakMap entry disappears automatically with the message).
 */
import type { ChatMessage } from '../../../shared/types'

const textCache = new WeakMap<ChatMessage, string>()

/** The searchable text of a message: lower-cased, spaces collapsed. */
export function messageText(msg: ChatMessage): string {
  const hit = textCache.get(msg)
  if (hit !== undefined) return hit
  const text = msg.parts
    .map((p) => (p.type === 'emote' ? [p.value, ...(p.overlays?.map((o) => o.value) ?? [])].join(' ') : p.value))
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
  textCache.set(msg, text)
  return text
}

/** Build a test function from the list of terms. Returns true for messages that should be hidden. */
export function compileBlacklist(terms: string[]): (msg: ChatMessage) => boolean {
  const needles = terms.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (needles.length === 0) return () => false
  return (msg) => {
    if (msg.event) return false // never hide events or mod notes
    const text = messageText(msg)
    return needles.some((n) => text.includes(n))
  }
}
