/**
 * renderer/src/lib/pings.ts   (who got @mentioned; pure helpers, no React)
 *
 * WHAT: Decides whether a chat message pings the user, so the app can play a sound / show a desktop notification.
 *   - `pingNamesFor`   the names that count: your Twitch login plus any extra names from Settings (e.g. your YouTube
 *                      @handle, since YouTube sign-in isn't used and we can't know it otherwise)
 *   - `findPing`       a message pings you when its text contains "@name" for one of those names (same "@name" rule
 *                      as the highlight chips in lib/mentions.ts) and it isn't your own message
 *   - `cleanPingName`  tidy one name typed into settings ("@Bob " -> "bob"), or undefined if it can't be a name
 *
 * Names are compared ignoring case. Only chat lines count (not events like subs).
 */
import type { ChatMessage } from '../../../shared/types'
import { splitMentions } from './mentions'

export const MAX_PING_NAMES = 10

/** "@Bob " -> "bob". Names are 3-25 letters, digits or underscores (the same shape lib/mentions.ts matches). */
export function cleanPingName(raw: string): string | undefined {
  const name = raw.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_]{3,25}$/.test(name) ? name : undefined
}

/** Lower-cased names to listen for, without duplicates. */
export function pingNamesFor(login: string | undefined, extra: string[]): string[] {
  const names = new Set<string>()
  const own = login ? cleanPingName(login) : undefined
  if (own) names.add(own)
  for (const e of extra) {
    const n = cleanPingName(e)
    if (n) names.add(n)
  }
  return [...names]
}

/** The name that was pinged, or undefined. Your own messages never ping you. */
export function findPing(msg: ChatMessage, names: string[]): string | undefined {
  if (names.length === 0 || msg.event || msg.removed) return undefined
  if (names.includes(msg.author.name.toLowerCase())) return undefined
  for (const part of msg.parts) {
    if (part.type !== 'text') continue
    for (const piece of splitMentions(part.value)) {
      if (piece.kind === 'mention' && names.includes(piece.name.toLowerCase())) return piece.name.toLowerCase()
    }
  }
  return undefined
}
