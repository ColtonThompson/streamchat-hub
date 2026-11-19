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
import type { Platform, StreamInfoTarget } from '../../../shared/types'

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

export function streamInfoTarget(show: boolean, channels: Record<Platform, string>, key: string): StreamInfoTarget | null {
  if (!show) return null
  return primaryChannel(channels, key)
}

/** 1234 -> "1,234". */
export const formatViewers = (n: number) => n.toLocaleString('en-US')
