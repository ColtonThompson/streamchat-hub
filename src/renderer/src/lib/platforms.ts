/**
 * renderer/src/lib/platforms.ts
 *
 * WHAT: How each platform looks: its display name, brand colour and 1-2 letter badge.
 *
 * The colour is used for the stripe on each message, the small square beside it, and the lit chip in
 * the top bar. Change a colour here and it changes everywhere. To support a new platform, add an
 * entry (TypeScript will remind you, because the type requires one for every `Platform`).
 */
import type { Platform } from '../../../shared/types'

export const PLATFORM_META: Record<Platform, { label: string; color: string; glyph: string }> = {
  twitch: { label: 'Twitch', color: '#9b6bff', glyph: 'Tw' },
  youtube: { label: 'YouTube', color: '#ff5a5f', glyph: 'Yt' },
  kick: { label: 'Kick', color: '#5df06a', glyph: 'Ki' },
  x: { label: 'X', color: '#d7dbe0', glyph: 'X' },
  tiktok: { label: 'TikTok', color: '#3fe3d9', glyph: 'Tk' }
}
