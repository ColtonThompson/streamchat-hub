/**
 * shared/channels.ts
 *
 * WHAT: Turns whatever the user typed into a platform's channel box into a clean list of sources
 *       to read: Twitch channel names, or YouTube streams.
 *
 * HOW IT FITS: Used in BOTH the UI (to show/validate what was typed) and the main process (never
 *       trust input that crossed the IPC boundary; it is cleaned again there).
 *       Use `parseSources(platform, raw)`: it picks the right rules for the platform.
 *
 * CHANGE IT WHEN: a platform needs its own input rules (add a parser and a case in `parseSources`).
 */
import type { Platform } from './types'

/** Twitch logins: lowercase letters, digits and underscores, up to 25 characters. */
const VALID = /^[a-z0-9_]{1,25}$/

/**
 * "Streamer1, twitch.tv/streamer2 #streamer3" -> ["streamer1", "streamer2", "streamer3"]
 *
 * Accepts commas or spaces between names, a leading "#", and pasted twitch.tv URLs.
 * Invalid entries are silently dropped; duplicates are removed; at most 20 are kept
 * (Twitch limits how fast an anonymous connection may join channels).
 */
export function parseChannels(raw: string): string[] {
  const out = new Set<string>() // a Set removes duplicates and keeps insertion order
  for (const token of raw.split(/[\s,]+/)) {
    const name = token
      .toLowerCase()
      .replace(/^https?:\/\//, '') // drop "https://"
      .replace(/^(www\.)?twitch\.tv\//, '') // drop "twitch.tv/"
      .replace(/^#/, '') // drop IRC-style "#"
      .replace(/[/?#].*$/, '') // drop anything after the name, e.g. "/videos" or "?foo"
    if (VALID.test(name)) out.add(name)
    if (out.size >= 20) break
  }
  return [...out]
}

// ============================================================================================
// YouTube
// ============================================================================================

/**
 * YouTube can be pointed at a stream in three ways, so a "source" is one of:
 *   - a VIDEO id        "dQw4w9WgXcQ"   (11 characters; case matters!). Reads that one stream.
 *   - a HANDLE          "@mychannel"    Reads whatever that channel is live with, and waits for the
 *                                        next stream when it is offline. Best for your own channel.
 *   - a CHANNEL id      "UCxxxxxxxxxxxxxxxxxxxxxx" (24 characters). Same as a handle.
 * Handles must keep their "@": without it, "mychannel" can't be told apart from a video id.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const HANDLE = /^@[A-Za-z0-9._-]{3,30}$/

/** What kind of source is this already-cleaned string? */
export function youtubeSourceKind(source: string): 'video' | 'handle' | 'channel' | undefined {
  if (CHANNEL_ID.test(source)) return 'channel' // check before 'video': neither pattern overlaps, but be explicit
  if (HANDLE.test(source)) return 'handle'
  if (VIDEO_ID.test(source)) return 'video'
  return undefined
}

/** One typed token -> a clean source, or undefined if it isn't recognisable. Accepts pasted URLs. */
function cleanYouTubeToken(token: string): string | undefined {
  let t = token.trim().replace(/^https?:\/\//i, '').replace(/^(www\.|m\.|music\.)/i, '')

  // Full links. Everything after the id (extra query parameters like "&t=30s") is ignored.
  let m = /^youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})/i.exec(t)
  m ??= /^youtu\.be\/([A-Za-z0-9_-]{11})/i.exec(t)
  m ??= /^youtube\.com\/(?:live|embed|v)\/([A-Za-z0-9_-]{11})/i.exec(t)
  if (m) return m[1]
  m = /^youtube\.com\/(@[A-Za-z0-9._-]{3,30})/i.exec(t)
  if (m) return m[1].toLowerCase() // handles are not case sensitive
  m = /^youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/i.exec(t)
  if (m) return m[1]

  t = t.replace(/[/?#].*$/, '')
  if (CHANNEL_ID.test(t) || VIDEO_ID.test(t)) return t
  if (HANDLE.test(t)) return t.toLowerCase()
  return undefined
}

/** At most this many YouTube streams are read at once (each one polls YouTube every few seconds). */
const MAX_YOUTUBE_SOURCES = 5

/**
 * "https://youtu.be/dQw4w9WgXcQ, @mychannel" -> ["dQw4w9WgXcQ", "@mychannel"]
 * Invalid entries are dropped, duplicates removed, extras past the limit ignored.
 */
export function parseYouTubeSources(raw: string): string[] {
  const out = new Set<string>()
  for (const token of raw.split(/[\s,]+/)) {
    const source = token ? cleanYouTubeToken(token) : undefined
    if (source) out.add(source)
    if (out.size >= MAX_YOUTUBE_SOURCES) break
  }
  return [...out]
}

/**
 * The small tag that says where a row came from: "#summit1g" for Twitch, "@mychannel" (or the channel's
 * name) for YouTube. YouTube falls back to the video id when no name could be found.
 */
export function channelTag(msg: { platform: Platform; channelId: string; channelLabel?: string }): string {
  if (msg.platform === 'youtube') return msg.channelLabel || msg.channelId
  return `#${msg.channelId}`
}

/** The cleaned list for whatever platform's box was typed in. Platforms without their own rules use Twitch's. */
export function parseSources(platform: Platform, raw: string): string[] {
  return platform === 'youtube' ? parseYouTubeSources(raw) : parseChannels(raw)
}
