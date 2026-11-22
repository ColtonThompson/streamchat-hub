/**
 * renderer/src/lib/streaminfo.ts
 *
 * WHAT: Decides which stream the title bar (title + category + viewers above the chat) follows.
 *
 * RULE: the bar always follows ONE stream, even when several channels are in the feed: the channel you added first,
 *   unless you picked another one in the Channels menu (that choice is `titleSource`, a `channelKey`). If the chosen
 *   channel has since been removed, it falls back to the first remaining one. Nothing is followed when the setting is
 *   off or there are no channels. (Following one stream keeps the title and viewer polling light: each stream followed
 *   is another request every few seconds.)
 */
import { parseSources } from '../../../shared/channels'
import type { Platform, StreamInfo, StreamInfoTarget } from '../../../shared/types'

/** One channel in the feed: a Twitch login, or a YouTube source (see shared/channels.ts). */
export interface ChannelRef {
  platform: 'twitch' | 'youtube'
  source: string
}

/** The text a channel is remembered by, e.g. "twitch:nightleaf". */
export const channelKey = (c: ChannelRef): string => `${c.platform}:${c.source}`

/** Every channel in the feed, Twitch first, then YouTube, each platform in the order they were added. */
export function allChannels(channels: Record<Platform, string>): ChannelRef[] {
  return (['twitch', 'youtube'] as const).flatMap((platform) => parseSources(platform, channels[platform]).map((source) => ({ platform, source })))
}

/** The channel the title bar follows: the one chosen by `key`, else the first one. */
export function primaryChannel(channels: Record<Platform, string>, key: string): ChannelRef | null {
  const all = allChannels(channels)
  return all.find((c) => channelKey(c) === key) ?? all[0] ?? null
}

/** Every channel in the feed as watch targets: all of them are checked for live status, the bar just shows one. */
export function watchTargets(channels: Record<Platform, string>): StreamInfoTarget[] {
  return allChannels(channels)
}

/** The latest info for one channel, if it has been checked yet. */
export function infoFor(infos: StreamInfo[], c: ChannelRef): StreamInfo | undefined {
  return infos.find((i) => i.platform === c.platform && i.source === c.source)
}

export interface StreamChange {
  kind: 'live' | 'offline' | 'title'
  info: StreamInfo
}

/**
 * What changed between two rounds of checks, for the notes in the feed. A channel seen for the first time is only a
 * baseline (joining a channel that is already live says nothing), and stale or unreadable answers never count.
 */
export function streamChanges(prev: StreamInfo[], next: StreamInfo[]): StreamChange[] {
  const out: StreamChange[] = []
  for (const info of next) {
    const before = prev.find((p) => p.platform === info.platform && p.source === info.source)
    if (!before || before.stale || info.stale || before.note || info.note) continue
    if (!before.live && info.live) out.push({ kind: 'live', info })
    else if (before.live && !info.live) out.push({ kind: 'offline', info })
    else if (before.live && info.live && before.title && info.title && before.title !== info.title) out.push({ kind: 'title', info })
  }
  return out
}

export function streamInfoTarget(show: boolean, channels: Record<Platform, string>, key: string): StreamInfoTarget | null {
  if (!show) return null
  return primaryChannel(channels, key)
}

/** 1234 -> "1,234". */
export const formatViewers = (n: number) => n.toLocaleString('en-US')
