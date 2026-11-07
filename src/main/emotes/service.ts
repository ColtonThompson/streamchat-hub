/**
 * main/emotes/service.ts   (EmoteService)
 *
 * WHAT: Makes 7TV / BetterTTV / FrankerFaceZ emotes appear in chat. Twitch's own emotes arrive
 *       already marked up inside each message; the third-party ones do NOT: to Twitch they are just
 *       words. So we download each channel's emote lists and, for every message, swap matching words
 *       for emote images.
 *
 * HOW IT WORKS:
 *   1. `registerChannel()` is called when we learn a channel's numeric Twitch id. It downloads that
 *      channel's emotes from every provider and merges them into one lookup table (word -> Emote).
 *      Global emotes (every channel) are downloaded once at startup.
 *   2. `ready()` lets the bus wait until a channel's table exists (with a short timeout).
 *   3. `process(message)` splits each text part into words and replaces known emote names.
 *
 * LOOKUP ORDER for a word: this channel's emotes first, then global ones. Within each group, the
 *   provider order from providers/index.ts decides (first wins). Twitch-native emotes are never
 *   touched because they're already emote parts, not text.
 *
 * ZERO-WIDTH EMOTES (overlays) are attached to the emote before them (`overlays` array) so they
 *   are drawn stacked on top of it.
 *
 * REFRESH: sets reload in the background (channels every 15 min, globals every 30) to pick up new emotes.
 *
 * HOW IT FITS: owned by MessageBus. Contains no Electron code, so it is easy to test on its own.
 *
 * CHANGE IT WHEN: you need different matching rules (case-insensitive? punctuation-tolerant?)
 *   see `process()`; or want live updates instead of polling.
 */
import type { ChatMessage, MessagePart } from '../../shared/types'
import { defaultProviders } from './providers'
import type { Emote, EmoteProvider } from './types'

const GLOBAL_REFRESH_MS = 30 * 60_000
const CHANNEL_REFRESH_MS = 15 * 60_000
/** Longest we make a message wait for emotes to download before showing it without them. */
const READY_TIMEOUT_MS = 3000

/** word -> emote. A Map gives instant lookups, important when processing hundreds of messages a minute. */
type EmoteMap = Map<string, Emote>

interface ChannelEntry {
  /** For log lines, e.g. "twitch:summit1g (id 26490481)". */
  label: string
  twitchId: string
  map: EmoteMap
  /** Resolves when `map` has been (re)loaded. */
  ready: Promise<void>
}

export class EmoteService {
  private globalMap: EmoteMap = new Map()
  private globalReady: Promise<void>
  /** "platform:channel" -> that channel's emotes. */
  private channels = new Map<string, ChannelEntry>()
  private timers: NodeJS.Timeout[] = []

  /** `providers` can be replaced in tests; normally it's the real 7TV/BTTV/FFZ list. */
  constructor(private providers: EmoteProvider[] = defaultProviders) {
    this.globalReady = this.loadGlobal()
    this.timers.push(setInterval(() => void (this.globalReady = this.loadGlobal()), GLOBAL_REFRESH_MS))
    this.timers.push(setInterval(() => this.refreshChannels(), CHANNEL_REFRESH_MS))
    // unref(): these timers must not keep the program alive on their own.
    this.timers.forEach((t) => t.unref?.())
  }

  dispose(): void {
    this.timers.forEach(clearInterval)
  }

  // ------------------------------------------------------------------------------ public API

  /** Called when a platform tells us a channel's numeric id. Safe to call repeatedly (a no-op if unchanged). */
  registerChannel(platform: string, channel: string, twitchId: string): void {
    const key = `${platform}:${channel}`
    if (this.channels.get(key)?.twitchId === twitchId) return
    const entry: ChannelEntry = { label: `${key} (id ${twitchId})`, twitchId, map: new Map(), ready: Promise.resolve() }
    entry.ready = this.loadChannel(entry)
    this.channels.set(key, entry)
  }

  /** Resolves when this channel's emotes are loaded, or after a short timeout so chat never stalls. */
  async ready(platform: string, channel: string): Promise<void> {
    const pending = [this.globalReady, this.channels.get(`${platform}:${channel}`)?.ready]
    // Promise.race: whichever finishes first wins: loaded, or the 3 s timeout.
    await Promise.race([Promise.all(pending), new Promise<void>((r) => setTimeout(r, READY_TIMEOUT_MS).unref?.())])
  }

  /** Returns a copy of the message with third-party emote words replaced by emote parts. */
  process(msg: ChatMessage): ChatMessage {
    if (msg.platform !== 'twitch') return msg // 3rd-party sets here are Twitch-specific for now
    const channelMap = this.channels.get(`${msg.platform}:${msg.channelId}`)?.map

    const out: MessagePart[] = []
    for (const part of msg.parts) {
      if (part.type !== 'text') {
        out.push(part) // links and native emotes pass through untouched
        continue
      }
      // split(/(\s+)/) keeps the whitespace as its own items, so spacing is preserved exactly.
      for (const token of part.value.split(/(\s+)/)) {
        if (!token) continue
        const emote = /^\s+$/.test(token) ? undefined : (channelMap?.get(token) ?? this.globalMap.get(token))
        if (!emote) {
          this.pushText(out, token)
        } else if (emote.zeroWidth && this.attachOverlay(out, emote)) {
          // it was stacked onto the previous emote: nothing more to do
        } else {
          out.push({ type: 'emote', value: emote.name, url: emote.url, source: emote.source })
        }
      }
    }
    return { ...msg, parts: out }
  }

  // --------------------------------------------------------------------------------- loading

  /**
   * Ask every provider in parallel and merge their answers into one lookup table.
   * `Promise.allSettled` (not `Promise.all`) means one provider failing doesn't discard the others.
   * Prints a summary line to the terminal: handy when emotes seem to be missing.
   */
  private async fetchAll(label: string, load: (p: EmoteProvider) => Promise<Emote[]>): Promise<EmoteMap> {
    const results = await Promise.allSettled(this.providers.map(load))
    const map: EmoteMap = new Map()
    const summary: string[] = []
    results.forEach((r, i) => {
      const name = this.providers[i].name
      if (r.status === 'fulfilled') {
        summary.push(`${name} ${r.value.length}`)
        for (const e of r.value) if (!map.has(e.name)) map.set(e.name, e) // first provider wins a name clash
      } else {
        summary.push(`${name} FAILED`)
        console.warn(`[emotes] ${label}: ${name} failed:`, r.reason instanceof Error ? r.reason.message : r.reason)
      }
    })
    console.log(`[emotes] ${label}: ${summary.join(', ')}`)
    return map
  }

  private async loadGlobal(): Promise<void> {
    const map = await this.fetchAll('global', (p) => p.global())
    if (map.size) this.globalMap = map // keep the old set if every provider failed
  }

  private async loadChannel(entry: ChannelEntry): Promise<void> {
    const map = await this.fetchAll(entry.label, (p) => p.channel(entry.twitchId))
    if (map.size || entry.map.size === 0) entry.map = map // don't wipe a good set because a refresh came back empty
  }

  private refreshChannels(): void {
    for (const entry of this.channels.values()) entry.ready = this.loadChannel(entry)
  }

  // --------------------------------------------------------------------- message rewriting

  /** Append text, merging with the previous part if that is also text (avoids many tiny parts). */
  private pushText(parts: MessagePart[], text: string): void {
    const last = parts[parts.length - 1]
    if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', value: last.value + text }
    else parts.push({ type: 'text', value: text })
  }

  /**
   * Stack a zero-width emote on the previous emote (looking back past any spaces).
   * Returns false when there is no emote to stack on, in which case the caller shows it normally.
   */
  private attachOverlay(parts: MessagePart[], emote: Emote): boolean {
    let i = parts.length - 1
    while (i >= 0) {
      const p = parts[i]
      if (p.type === 'text' && /^\s*$/.test(p.value)) i-- // skip whitespace-only parts
      else break
    }
    const base = parts[i]
    if (!base || base.type !== 'emote') return false
    parts.length = i + 1 // drop the spaces between the base emote and the overlay
    parts[i] = { ...base, overlays: [...(base.overlays ?? []), { value: emote.name, url: emote.url }] }
    return true
  }
}
