/**
 * renderer/src/lib/mentions.ts   (@mentions: highlighting and Tab completion)
 *
 * WHAT: Pure helpers (no React, no store) for two features around "@username":
 *   1. HIGHLIGHTING: `splitMentions` cuts a message's text into plain pieces and @mention pieces, so
 *      MessageRow can draw each mention as a chip (components/MentionChip.tsx).
 *   2. TAB COMPLETION: when you type "@sh" in the message box and press Tab, `completeMention` finishes
 *      it with the most recent chatter whose name starts with "sh"; Tab again cycles to the next match
 *      (Shift+Tab goes back). The message box (components/Composer.tsx) just calls it.
 *
 * Being pure makes them easy to test: same input, same output.
 *
 * WHAT COUNTS AS A MENTION: "@" followed by 3-25 letters, digits or underscores, and NOT glued to a
 * preceding word. So "hey @pixelwitch," matches (the comma is not part of the name), but an email like
 * "me@example.com" does not.
 *
 * KNOWN LIMIT: only names made of plain A-Z, 0-9 and _ are offered for completion. Twitch lets people
 * show a localized display name (e.g. in Japanese) whose login is different, and we only know the
 * display name, so "@<that name>" would not ping them. Those names are skipped rather than
 * completed wrongly.
 */
import type { ChatMessage, Platform } from '../../../shared/types'

// ============================================================================ highlighting

export type MentionPiece = { kind: 'text'; value: string } | { kind: 'mention'; value: string; name: string }

/**
 * `(?<![\w@])`  the "@" must not follow a word character (blocks emails) or another "@"
 * `(\w{3,25})`  the name; `\w` = letters, digits, underscore
 */
const MENTION = /(?<![\w@])@([A-Za-z0-9_]{3,25})(?!\w)/g

/**
 * "hey @Bob, thanks" -> [text "hey ", mention "@Bob" (name "Bob"), text ", thanks"].
 * Concatenating every piece's `value` always gives back the original text.
 */
export function splitMentions(text: string): MentionPiece[] {
  const pieces: MentionPiece[] = []
  let last = 0
  for (const m of text.matchAll(MENTION)) {
    const at = m.index as number
    if (at > last) pieces.push({ kind: 'text', value: text.slice(last, at) })
    pieces.push({ kind: 'mention', value: m[0], name: m[1] })
    last = at + m[0].length
  }
  if (last < text.length) pieces.push({ kind: 'text', value: text.slice(last) })
  return pieces
}

// ============================================================================ completion

/** Names we can complete: plain Twitch-style logins only (see KNOWN LIMIT above). */
const COMPLETABLE = /^[A-Za-z0-9_]{1,25}$/

/**
 * The people who chatted most recently in one channel, newest first, each once.
 * Skips event rows, and people who were since banned or timed out.
 */
export function recentChatters(messages: ChatMessage[], platform: Platform, channelId: string, limit = 300): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i]
    if (m.platform !== platform || m.channelId !== channelId || m.event) continue
    if (m.removed === 'ban' || m.removed === 'timeout') continue
    const name = m.author.name
    const key = name.toLowerCase()
    if (!COMPLETABLE.test(name) || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** The "@prefix" being typed right before the cursor, if any: where it starts and what has been typed after the "@". */
export function mentionAt(text: string, cursor: number): { start: number; prefix: string } | undefined {
  const m = /(?<![\w@])@([A-Za-z0-9_]{0,25})$/.exec(text.slice(0, cursor))
  return m ? { start: m.index, prefix: m[1] } : undefined
}

/** What the box remembers between Tab presses, so pressing Tab again cycles instead of starting over. */
export interface CompletionSession {
  /** Where the "@" is in the text. */
  start: number
  /** Every name that matched, newest chatter first. */
  matches: string[]
  /** Which match is currently inserted. */
  index: number
  /** How many characters the inserted "@Name" (plus trailing space) takes up. */
  tokenLen: number
  /** The exact text and cursor right after we inserted it. If either differs, the user did something else and the session is over. */
  text: string
  cursor: number
}

export interface Completion {
  text: string
  cursor: number
  /** Pass this back in on the next Tab. Undefined when nothing was completed. */
  session?: CompletionSession
}

/**
 * Handle a Tab press in the message box.
 *   - Returns `undefined` when the cursor is NOT in a "@word": the caller should let Tab behave normally.
 *   - Otherwise Tab is "ours": returns the new text and cursor (unchanged text if nothing matched).
 *
 * `chatters` is `recentChatters(...)`, newest first. `session` is what the previous call returned.
 */
export function completeMention(
  text: string,
  cursor: number,
  chatters: string[],
  session?: CompletionSession,
  backwards = false,
  maxLength = 500
): Completion | undefined {
  let start: number
  let matches: string[]
  let index: number
  let replaceLen: number

  if (session && text === session.text && cursor === session.cursor) {
    // Tab pressed again right after a completion: swap in the next (or previous) match.
    start = session.start
    matches = session.matches
    index = (session.index + (backwards ? -1 : 1) + matches.length) % matches.length
    replaceLen = session.tokenLen
  } else {
    const at = mentionAt(text, cursor)
    if (!at) return undefined
    const prefix = at.prefix.toLowerCase()
    matches = chatters.filter((n) => n.toLowerCase().startsWith(prefix))
    if (!matches.length) return { text, cursor } // handled (so focus doesn't jump away), but nothing to insert
    start = at.start
    index = backwards ? matches.length - 1 : 0
    replaceLen = cursor - start
  }

  const after = text.slice(start + replaceLen)
  // Add a space after the name for convenience, unless one is already there.
  const token = `@${matches[index]}` + (after.startsWith(' ') ? '' : ' ')
  const next = text.slice(0, start) + token + after
  if (next.length > maxLength) return { text, cursor }
  const newCursor = start + token.length + (after.startsWith(' ') ? 1 : 0)
  return { text: next, cursor: newCursor, session: { start, matches, index, tokenLen: token.length, text: next, cursor: newCursor } }
}
