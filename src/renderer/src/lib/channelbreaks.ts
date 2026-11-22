/**
 * renderer/src/lib/channelbreaks.ts   (the "joined / left" dividers in the feed)
 *
 * WHAT: When a channel is added to or removed from the feed, a divider row is put in the chat so you can see where
 * the previous chat ends and the new one starts coming in ("Joined #nightleaf", "Left #nightleaf"). A divider is a
 * normal ChatMessage whose `event.type` is 'break'; ChatFeed draws it as a line with the text in the middle
 * (components/FeedBreak.tsx). It always shows, even with "Show events" off, and is skipped by the row shading.
 *
 * Pure (no React, no store), so it is easy to test.
 */
import { youtubeSourceKind } from '../../../shared/channels'
import type { ChatMessage, Platform } from '../../../shared/types'

/** How a source reads in the divider: "#nightleaf" (Twitch), "@handle" or "stream dQw4w9WgXcQ" (YouTube). */
export function sourceLabel(platform: Platform, source: string): string {
  if (platform === 'youtube') return youtubeSourceKind(source) === 'video' ? `stream ${source}` : source
  return `#${source}`
}

let counter = 0

/** One divider row. */
export function makeBreak(platform: Platform, source: string, kind: 'joined' | 'left', now = Date.now()): ChatMessage {
  const where = sourceLabel(platform, source)
  return {
    id: `break:${now}:${counter++}`,
    platform,
    channelId: source,
    author: { name: '', badges: [] },
    parts: [],
    timestamp: now,
    event: { type: 'break', title: kind === 'joined' ? `Joined ${where}` : `Left ${where}` }
  }
}

/** A divider for a stream going live / offline or changing its title (see lib/streaminfo.ts `streamChanges`). */
export function makeStreamNote(platform: Platform, source: string, kind: 'live' | 'offline' | 'title', title?: string, now = Date.now()): ChatMessage {
  const where = sourceLabel(platform, source)
  const text = kind === 'live' ? `${where} went live${title ? `: ${title}` : ''}` : kind === 'offline' ? `${where} went offline` : `${where} changed the title: ${title ?? ''}`
  return {
    id: `break:${now}:${counter++}`,
    platform,
    channelId: source,
    author: { name: '', badges: [] },
    parts: [],
    timestamp: now,
    event: { type: 'break', title: text }
  }
}

/** The dividers for a change from one channel list to another: "left" for each one dropped, then "joined" for each new one. */
export function channelBreaks(platform: Platform, before: string[], after: string[], now = Date.now()): ChatMessage[] {
  const had = new Set(before)
  const has = new Set(after)
  return [
    ...before.filter((c) => !has.has(c)).map((c) => makeBreak(platform, c, 'left', now)),
    ...after.filter((c) => !had.has(c)).map((c) => makeBreak(platform, c, 'joined', now))
  ]
}

/** Does this divider mean something ended (left a channel, stream went offline)? Drawn in a quieter colour. */
export const isEndBreak = (title: string): boolean => title.startsWith('Left ') || title.endsWith(' went offline')

/** Is this row a divider? */
export const isBreak = (msg: ChatMessage): boolean => msg.event?.type === 'break'
