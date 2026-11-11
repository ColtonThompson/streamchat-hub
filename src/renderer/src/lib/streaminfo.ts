/**
 * renderer/src/lib/streaminfo.ts
 *
 * WHAT: Decides whether the stream-info bar (title + viewers) applies, and for which stream.
 *
 * RULE: only when the setting is on AND exactly one stream is being read overall: one Twitch channel or one
 *   YouTube stream, with no other platform switched on. With several streams mixed into one feed, "the" title
 *   and viewer count would be ambiguous, so nothing is shown (and nothing is fetched).
 */
import { parseSources } from '../../../shared/channels'
import { PLATFORMS, type Platform, type StreamInfoTarget } from '../../../shared/types'

export function streamInfoTarget(show: boolean, enabled: Record<Platform, boolean>, channels: Record<Platform, string>): StreamInfoTarget | null {
  if (!show) return null
  let total = 0
  let only: StreamInfoTarget | null = null
  for (const p of PLATFORMS) {
    if (!enabled[p]) continue
    if (p === 'twitch' || p === 'youtube') {
      const sources = parseSources(p, channels[p])
      total += sources.length
      if (sources.length === 1) only = { platform: p, source: sources[0] }
    } else {
      total += 1 // another platform's chat is mixed into the feed, so it is not "a single stream" any more
    }
  }
  return total === 1 ? only : null
}

/** 1234 -> "1,234". */
export const formatViewers = (n: number) => n.toLocaleString('en-US')
