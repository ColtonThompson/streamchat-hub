/**
 * main/adapters/youtube/innertube.ts   (talking to YouTube)
 *
 * WHAT: The network side of the YouTube adapter. Three jobs:
 *   1. FIND A LIVE STREAM for a channel handle ("@name") or channel id: `findLiveVideo`.
 *   2. OPEN a stream's chat: `openChat` loads the chat page and pulls out what we need to start polling.
 *   3. POLL it: `pollChat` asks "anything new since my last token?" and returns the new actions plus the
 *      token for the next question.
 *
 * WHY THIS WAY (read before changing): YouTube's OFFICIAL chat API (liveChatMessages.list) needs a
 * Google sign-in and an API key, and its daily quota (10,000 units, ~5 per poll) runs out partway
 * through a long stream. So, like most chat overlays, we read chat the way YouTube's own chat window
 * does: the public "InnerTube" endpoint. It needs no sign-in and has no quota. The trade-off: it is
 * NOT a documented API, so YouTube can change it without notice. If chat ever stops loading, this file
 * (page scraping) and parse.ts (message shapes) are the only places to fix. Nothing else knows how
 * YouTube works. SENDING chat messages is not done here: that needs the official API and sign-in.
 *
 * HOW A POLL WORKS: the chat page contains a "continuation" token (an opaque bookmark). POSTing it to
 * /youtubei/v1/live_chat/get_live_chat returns the messages after that bookmark, a NEW token, and how
 * long to wait before asking again. A response with no new token means the chat has ended.
 *
 * Everything that parses text is a separate exported function so it can be tested without a network.
 */

const WATCH = 'https://www.youtube.com'
/** A normal desktop-Chrome identity. YouTube serves a stripped-down page to unknown clients. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
/** SOCS=CAI is the "I've answered the cookie banner" cookie. Without it, EU visitors are redirected to a consent page. */
const COMMON_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI' }
const TIMEOUT_MS = 15_000

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const rec = (v: unknown): Rec | undefined => (isRec(v) ? v : undefined)

/** Thrown for problems that retrying won't fix (chat disabled, members-only...). The message is shown to the user. */
export class ChatUnavailableError extends Error {}

// ============================================================================ finding a live stream

/** What a channel's "/live" page tells us. */
export interface LiveInfo {
  videoId: string
  title?: string
  /** The channel's display name, when the page says it. */
  owner?: string
}

/** Decode the few HTML entities that appear in page titles. */
const unescapeHtml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** The channel name from a watch/live page's HTML, or undefined. */
export function parseOwnerName(html: string): string | undefined {
  // The watch page names the channel twice; either is fine. JSON strings may contain \uXXXX escapes.
  const raw = /"ownerChannelName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1] ?? /"author":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1]
  if (!raw) return undefined
  try {
    const name = (JSON.parse(`"${raw}"`) as string).trim()
    return name || undefined
  } catch {
    return undefined
  }
}

/**
 * Read the HTML of "youtube.com/@name/live". When the channel IS live, YouTube serves that stream's watch
 * page (its canonical link names the video and its data says "isLiveNow"). When it isn't, we get the
 * channel page or an old stream, which this rejects: both checks must pass, so a past stream is never mistaken for a live one.
 */
export function parseLivePage(html: string): LiveInfo | undefined {
  const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/.exec(html)
  const live = /"liveBroadcastDetails":\{[^}]*"isLiveNow":true/.test(html)
  if (!canonical || !live) return undefined
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]
  return { videoId: canonical[1], title: title ? unescapeHtml(title) : undefined, owner: parseOwnerName(html) }
}

/** Best effort: the channel name behind a video id (for sources typed as a single stream). Never throws. */
export async function findOwnerName(videoId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${WATCH}/watch?v=${encodeURIComponent(videoId)}`, { headers: COMMON_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res.ok ? parseOwnerName(await res.text()) : undefined
  } catch {
    return undefined
  }
}

/** `source` is "@handle" or "UC..." (a channel id). Returns the live stream, or undefined when offline. */
export async function findLiveVideo(source: string): Promise<LiveInfo | undefined> {
  const path = source.startsWith('@') ? source : `channel/${source}`
  const res = await fetch(`${WATCH}/${path}/live`, { headers: COMMON_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) throw new ChatUnavailableError(`${source} was not found on YouTube`)
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${source}`)
  return parseLivePage(await res.text())
}

// ============================================================================== opening a chat

/** Everything needed to start polling a stream's chat. */
export interface ChatSession {
  apiKey: string
  clientVersion: string
  /** The first bookmark. */
  continuation: string
  /** Recent messages already in the chat when we joined (shown so you don't join a blank screen). */
  initialActions: unknown[]
}

/** Pull the big JSON object that YouTube embeds in every page as `ytInitialData`. */
export function extractInitialData(html: string): Rec | undefined {
  const m = /(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*(\{.+?\})\s*;\s*<\/script>/s.exec(html)
  if (!m) return undefined
  try {
    return rec(JSON.parse(m[1]))
  } catch {
    return undefined
  }
}

/** The continuation token (and how long to wait) from either page data or a poll response. */
export function nextContinuation(continuations: unknown): { token: string; timeoutMs: number } | undefined {
  const first = rec(Array.isArray(continuations) ? continuations[0] : undefined)
  if (!first) return undefined
  // Which wrapper YouTube uses varies; all of them carry `continuation`, most carry `timeoutMs`.
  const data = rec(first.invalidationContinuationData) ?? rec(first.timedContinuationData) ?? rec(first.reloadContinuationData)
  const token = typeof data?.continuation === 'string' ? data.continuation : undefined
  if (!token) return undefined
  const ms = typeof data?.timeoutMs === 'number' ? data.timeoutMs : 5000
  // Clamp: never hammer YouTube (< 1 s) and never go stale if it asks for a very long wait (> 8 s).
  return { token, timeoutMs: Math.min(8000, Math.max(1000, ms)) }
}

/**
 * Parse the chat page's HTML into a ChatSession. Throws `ChatUnavailableError` with a readable reason
 * when the stream has no live chat (not live, chat off, replay, members only...).
 */
export function parseChatPage(html: string): ChatSession {
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1]
  const clientVersion = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1]
  const data = extractInitialData(html)
  if (!apiKey || !clientVersion || !data) throw new Error('YouTube chat page had an unexpected layout')

  const chat = rec(rec(data.contents)?.liveChatRenderer)
  if (!chat) {
    // Instead of a chat, the page carries a message such as "Chat is disabled for this live stream."
    const msg = rec(rec(data.contents)?.messageRenderer)
    const text = JSON.stringify(msg?.text ?? '')
    const reason = /disabled/i.test(text) ? 'chat is turned off for this stream' : /member/i.test(text) ? 'chat is members-only' : 'no live chat on this video'
    throw new ChatUnavailableError(reason)
  }
  if (chat.isReplay === true) throw new ChatUnavailableError('this stream is not live (chat replay only)')

  const next = nextContinuation(chat.continuations)
  if (!next) throw new ChatUnavailableError('this stream has no live chat')
  return { apiKey, clientVersion, continuation: next.token, initialActions: Array.isArray(chat.actions) ? chat.actions : [] }
}

export async function openChat(videoId: string): Promise<ChatSession> {
  const res = await fetch(`${WATCH}/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`, {
    headers: COMMON_HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404) throw new ChatUnavailableError('video not found')
  if (!res.ok) throw new Error(`HTTP ${res.status} loading chat`)
  return parseChatPage(await res.text())
}

// ================================================================================== polling

export interface PollResult {
  actions: unknown[]
  /** The bookmark for the next poll, or undefined when the chat has ended. */
  next?: { token: string; timeoutMs: number }
}

/** Read a poll response's JSON. Exported for tests. */
export function parsePollResponse(json: unknown): PollResult {
  const c = rec(rec(rec(json)?.continuationContents)?.liveChatContinuation)
  // No `liveChatContinuation` at all = the chat is gone (the stream ended).
  if (!c) return { actions: [] }
  return { actions: Array.isArray(c.actions) ? c.actions : [], next: nextContinuation(c.continuations) }
}

export async function pollChat(session: ChatSession, token: string): Promise<PollResult> {
  const res = await fetch(`${WATCH}/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(session.apiKey)}&prettyPrint=false`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: session.clientVersion, hl: 'en' } },
      continuation: token
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} polling chat`)
  return parsePollResponse(await res.json())
}
