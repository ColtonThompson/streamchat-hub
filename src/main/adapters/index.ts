/**
 * main/adapters/index.ts
 *
 * WHAT: The adapter registry: "which code handles which platform?"
 *
 * HOW IT FITS: MessageBus.setEnabled() calls `createAdapter` when you switch a platform on.
 *
 * TO REPLACE A MOCK WITH A REAL ADAPTER: add a `case` for the platform below, e.g.
 *     case 'kick': return new KickAdapter(emit, channels)
 * Platforms without a case fall through to the mock adapter, which emits fake messages so the UI can
 * still be developed and tested without a real connection.
 */
import type { Platform } from '../../shared/types'
import type { AdapterEmit, ChatAdapter } from './base'
import { MockAdapter } from './mock'
import { TwitchAdapter } from './twitch'
import { YouTubeAdapter } from './youtube'

export function createAdapter(platform: Platform, emit: AdapterEmit, channels: string[]): ChatAdapter {
  switch (platform) {
    case 'twitch':
      return new TwitchAdapter(emit, channels)
    case 'youtube':
      return new YouTubeAdapter(emit, channels) // `channels` here are YouTube sources: @handles, channel ids, video ids
    default:
      return new MockAdapter(platform, emit)
  }
}
