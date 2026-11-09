/**
 * main/adapters/youtube/index.ts   (the YouTube adapter)
 *
 * WHAT: Reads YouTube live chat and feeds it into the app, next to Twitch.
 *
 * WHAT THE USER TYPES (the YouTube box): any mix of
 *     @yourhandle                      follows that channel: reads its live stream whenever it is live,
 *                                      and quietly waits (checking every 45 s) when it isn't
 *     UCxxxxxxxxxxxxxxxxxxxxxx         the same, by channel id
 *     https://youtu.be/<id>  or  <id>  one specific stream
 *   Up to 5 at once. (The text is cleaned by `parseYouTubeSources` in shared/channels.ts.)
 *
 * STRUCTURE: one `SourceReader` per thing typed. Each runs its own loop:
 *       find the live video  ->  open its chat  ->  poll every few seconds  ->  (chat ends) -> look again
 *   and recovers from network problems on its own (waits 1 s, 2 s, 4 s ... up to 30 s, then retries).
 *   The adapter class itself just keeps the set of readers matching what the user typed and combines
 *   their states into the single status chip in the top bar.
 *
 * WHICH FILE DOES WHAT:
 *   innertube.ts  talks to YouTube (find the stream, open the chat, poll)      <- fix here if YouTube changes
 *   parse.ts      turns YouTube's chat items into ChatMessage                  <- or here, for message shapes
 *   pacer.ts      spreads each poll's burst of messages over time
 *   index.ts      (this file) lifecycle, retries, de-duplication, status
 *
 * IDS: a message's `channelId` is the stream's VIDEO id (e.g. "dQw4w9WgXcQ"), not what was typed.
 *   Its `channelLabel` is the readable name (the typed @handle, else the channel's name) for the source tag.
 *   A handle can have a different video each day; the video id is what moderation events match on.
 *
 * NOT DONE YET: sending messages and moderating from the app (YouTube needs Google sign-in plus the
 *   official API for that; reading does not).
 */
import { youtubeSourceKind } from '../../../shared/channels'
import type { ChatMessage } from '../../../shared/types'
import type { AdapterEmit, ChatAdapter } from '../base'
import { ChatUnavailableError, findLiveVideo, findOwnerName, openChat, pollChat } from './innertube'
import { Pacer } from './pacer'
import { parseActions, type ChatItem } from './parse'

/** How often to check whether an offline channel has gone live (or a finished stream's chat has returned). */
const OFFLINE_POLL_MS = 45_000
/** How many message ids / names a reader remembers (oldest are forgotten first). */
const SEEN_LIMIT = 1500
const NAMES_LIMIT = 5000

/** Unknown chat item kinds are logged once each, so the console isn't flooded but a YouTube change is noticed. */
const warned = new Set<string>()
function warnOnce(kind: string): void {
  if (warned.has(kind)) return
  warned.add(kind)
  console.warn(`[youtube] unhandled chat item "${kind}" (ignored). If it matters, add it in adapters/youtube/parse.ts`)
}

/** What one reader is doing, for the status chip. */
export interface SourceState {
  /** live = reading chat; waiting = connected to YouTube but no stream to read yet; connecting = (re)trying; error = needs attention. */
  state: 'live' | 'waiting' | 'connecting' | 'error'
  /** A short phrase for the tooltip, e.g. "waiting for @name to go live". */
  detail: string
}

class SourceReader {
  state: SourceState = { state: 'connecting', detail: 'starting' }

  private stopped = false
  private abort = new AbortController() // wakes any sleep() early when we stop
  private pacer: Pacer<ChatItem>
  /** Ids of messages already shown: reopening a chat re-sends recent history, which must not appear twice. */
  private seen = new Set<string>()
  /** viewer channel id -> display name, to word "X was removed from chat". */
  private names = new Map<string, string>()
  /** Consecutive failures; drives the retry delay. Reset by every successful poll. */
  private failures = 0
  /** The channel name for a source typed as a single video (looked up once). */
  private ownerName: string | undefined

  constructor(
    readonly source: string,
    private emit: AdapterEmit,
    private onChange: () => void
  ) {
    this.pacer = new Pacer<ChatItem>((item) => this.deliver(item))
  }

  start(): void {
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.abort.abort()
    this.pacer.stop()
  }

  // ------------------------------------------------------------------------------- the loop

  private async run(): Promise<void> {
    const isVideo = youtubeSourceKind(this.source) === 'video'
    while (!this.stopped) {
      try {
        let videoId = this.source
        let title: string | undefined
        let label: string | undefined = this.source.startsWith('@') ? this.source : undefined
        if (!isVideo) {
          const live = await findLiveVideo(this.source)
          if (this.stopped) return
          if (!live) {
            this.failures = 0
            this.set('waiting', `waiting for ${this.source} to go live`)
            await this.sleep(OFFLINE_POLL_MS)
            continue
          }
          videoId = live.videoId
          title = live.title
          label ??= live.owner
        } else {
          this.ownerName ??= await findOwnerName(videoId) // once; a failure just leaves the video id as the tag
          label = this.ownerName
        }

        await this.read(videoId, title, label) // returns when the chat ends (or we are stopped)
        if (this.stopped) return
        this.set('waiting', isVideo ? 'stream ended' : `${this.source}'s stream ended; waiting for the next one`)
        await this.sleep(OFFLINE_POLL_MS)
      } catch (err) {
        if (this.stopped) return
        if (err instanceof ChatUnavailableError) {
          // Retrying won't help right now, but things change (a scheduled stream starts, chat is turned back on),
          // so keep checking slowly and show the reason.
          this.set('error', err.message)
          await this.sleep(OFFLINE_POLL_MS)
        } else {
          this.failures++
          const delay = Math.min(30_000, 1000 * 2 ** this.failures) + Math.random() * 500
          this.set('connecting', `connection problem, retrying in ${Math.round(delay / 1000)}s`)
          await this.sleep(delay)
        }
      }
    }
  }

  /** Open one stream's chat and keep polling it. Network errors are thrown to `run()`, which retries. */
  private async read(videoId: string, title: string | undefined, label: string | undefined): Promise<void> {
    this.set('connecting', 'opening chat')
    const session = await openChat(videoId)
    if (this.stopped) return
    this.set('live', title ?? `video ${videoId}`)
    this.process(session.initialActions, videoId, label, 0) // recent history: show immediately

    let token = session.continuation
    while (!this.stopped) {
      const poll = await pollChat(session, token)
      if (this.stopped) return
      this.failures = 0
      if (!poll.next) {
        this.process(poll.actions, videoId, label, 0) // no new token = the chat has ended
        return
      }
      this.process(poll.actions, videoId, label, poll.next.timeoutMs)
      token = poll.next.token
      await this.sleep(poll.next.timeoutMs)
    }
  }

  // --------------------------------------------------------------------------- messages

  /**
   * Parse a poll's actions and queue the new items. Actions are parsed ONE AT A TIME and names are
   * remembered as we go, so a removal later in the same poll can name the viewer from an earlier message.
   */
  private process(actions: unknown[], videoId: string, label: string | undefined, spanMs: number): void {
    const items: ChatItem[] = []
    const ctx = { videoId, channelLabel: label, nameOf: (id: string) => this.names.get(id), onUnknown: warnOnce }
    for (const action of actions) {
      for (const item of parseActions([action], ctx)) {
        if (item.kind === 'message') {
          if (this.seen.has(item.message.id)) continue // already shown (history re-sent after a reconnect)
          this.remember(item.message)
        } else if (item.action.type === 'delete-message') {
          // A message can only be deleted once, so a repeat (after a reconnect) is skipped.
          // (Bans are NOT de-duplicated: a viewer can legitimately be banned, unbanned and banned again.)
          const key = `del:${item.action.messageId}`
          if (this.seen.has(key)) continue
          this.seen.add(key)
        }
        items.push(item)
      }
    }
    this.pacer.push(items, spanMs)
  }

  private remember(m: ChatMessage): void {
    this.seen.add(m.id)
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string)
    if (m.author.id && m.author.name) {
      this.names.set(m.author.id, m.author.name)
      if (this.names.size > NAMES_LIMIT) this.names.delete(this.names.keys().next().value as string)
    }
  }

  /** The pacer calls this as each item's turn comes. */
  private deliver(item: ChatItem): void {
    if (this.stopped) return
    if (item.kind === 'message') this.emit.message(item.message)
    else this.emit.moderation?.(item.action)
  }

  // ----------------------------------------------------------------------------- helpers

  private set(state: SourceState['state'], detail: string): void {
    this.state = { state, detail }
    this.onChange()
  }

  /** Wait `ms`, or less if we are stopped. */
  private sleep(ms: number): Promise<void> {
    const signal = this.abort.signal
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      signal.addEventListener('abort', done, { once: true })
    })
  }
}

export class YouTubeAdapter implements ChatAdapter {
  readonly platform = 'youtube' as const

  private wanted: string[]
  private readers = new Map<string, SourceReader>()
  private stopped = true
  private lastStatus = ''

  constructor(
    private emit: AdapterEmit,
    sources: string[]
  ) {
    this.wanted = sources
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.sync()
    this.report()
  }

  disconnect(): void {
    this.stopped = true
    this.readers.forEach((r) => r.stop())
    this.readers.clear()
    this.lastStatus = ''
    this.emit.status({ state: 'disconnected' })
  }

  /** The user edited the box: start readers for new entries, stop those removed. */
  setChannels(sources: string[]): void {
    this.wanted = sources
    if (this.stopped) return
    this.sync()
    this.report()
  }

  /** Make the set of running readers match `wanted`. */
  private sync(): void {
    for (const [source, reader] of this.readers) {
      if (!this.wanted.includes(source)) {
        reader.stop()
        this.readers.delete(source)
      }
    }
    for (const source of this.wanted) {
      if (this.readers.has(source)) continue
      const reader = new SourceReader(source, this.emit, () => this.report())
      this.readers.set(source, reader)
      reader.start()
    }
  }

  /** Combine every reader's state into the one chip. (Skips identical repeats so the UI isn't spammed.) */
  private report(): void {
    if (this.stopped) return
    const readers = [...this.readers.values()]
    let status: Parameters<AdapterEmit['status']>[0]
    if (!readers.length) {
      status = { state: 'connected', detail: 'add a stream link or @handle to start reading' }
    } else {
      const label = (r: SourceReader) => (youtubeSourceKind(r.source) === 'video' ? `video ${r.source}` : r.source)
      const detail = readers.map((r) => `${label(r)}: ${r.state.detail}`).join(' · ')
      const states = readers.map((r) => r.state.state)
      // Live or waiting both mean "connected to YouTube"; the tooltip says which. Only when every source
      // is in trouble is the chip red (that also shows the reason under the box).
      const state = states.some((s) => s === 'live' || s === 'waiting') ? 'connected' : states.every((s) => s === 'error') ? 'error' : 'connecting'
      status = { state, detail }
    }
    const key = JSON.stringify(status)
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.emit.status(status)
  }
}
