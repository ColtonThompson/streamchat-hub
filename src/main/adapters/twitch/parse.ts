/**
 * main/adapters/twitch/parse.ts
 *
 * WHAT: Converts parsed Twitch chat lines (see irc.ts) into the app's own types (shared/types.ts).
 *       This is where Twitch-specific knowledge lives: tag names, event ids, emote position format.
 *
 * FUNCTIONS (each takes an `IrcMessage`):
 *   privmsgToChatMessage     normal chat line               -> ChatMessage
 *   usernoticeToChatMessage  sub / gift / raid / announcement -> ChatMessage with `event` set
 *   clearmsgToAction         one message deleted              -> ModerationEvent
 *   parseClearChat           timeout / ban / chat cleared     -> ModerationEvent + a note row
 *
 * HOW IT FITS: adapters/twitch/index.ts calls these and emits the results to the MessageBus.
 *
 * CHANGE IT WHEN: Twitch adds something new (e.g. a new USERNOTICE `msg-id`: add it to EVENT_TYPES
 *   below) or you want to show different text/colours for an existing event.
 *
 * TIP: to see what Twitch actually sends for a message, log `line` in adapters/twitch/index.ts `handle()`.
 */
import type { Badge, ChatMessage, EventType, MessagePart, ModerationEvent } from '../../../shared/types'
import { formatDuration } from '../../../shared/duration'
import type { IrcMessage } from './irc'

/** Twitch's own emotes are images at a predictable URL built from the emote id. "2.0" = 2x size. */
const emoteUrl = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`

/** Short text for badges, shown only until the real badge image has loaded (or when signed out). */
const BADGE_LABELS: Record<string, string> = {
  broadcaster: 'HOST',
  moderator: 'MOD',
  vip: 'VIP',
  subscriber: 'SUB',
  founder: 'SUB',
  staff: 'STAFF',
  admin: 'ADMIN',
  partner: 'PARTNER'
}

/** Many viewers never pick a name colour; give them a stable readable one based on their name. */
const FALLBACK_COLORS = ['#ff7a90', '#7dd3fc', '#a3e635', '#f9a8d4', '#fbbf24', '#c4b5fd', '#5eead4', '#fb923c']
function fallbackColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0 // simple string hash
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

const URL_RE = /(https?:\/\/[^\s]+)/g

/** Add text to `parts`, turning any URLs inside it into clickable link parts. */
function pushText(parts: MessagePart[], text: string): void {
  // split() with a capturing group keeps the URLs in the result, so URLs and text alternate.
  for (const chunk of text.split(URL_RE)) {
    if (!chunk) continue
    if (/^https?:\/\//.test(chunk)) parts.push({ type: 'link', value: chunk, url: chunk })
    else parts.push({ type: 'text', value: chunk })
  }
}

interface Range {
  id: string
  start: number
  end: number
}

/**
 * Turn the message text + Twitch's `emotes` tag into a list of text/emote/link parts.
 *
 * The tag looks like "25:0-4,12-16/1902:6-10": emote id 25 occupies characters 0-4 and 12-16,
 * emote 1902 occupies 6-10. Positions count Unicode CHARACTERS (code points), not JavaScript's
 * UTF-16 units, so a message containing an emoji would shift everything if we indexed the string
 * directly. `Array.from(text)` splits by code point, which fixes that.
 */
function buildParts(text: string, emotesTag: string): MessagePart[] {
  const chars = Array.from(text)
  const ranges: Range[] = []

  if (emotesTag) {
    for (const group of emotesTag.split('/')) {
      const [id, positions] = group.split(':')
      if (!id || !positions || !/^[A-Za-z0-9_]{1,64}$/.test(id)) continue // the id goes into an image URL: plain characters only
      for (const r of positions.split(',')) {
        const [start, end] = r.split('-').map(Number)
        if (Number.isInteger(start) && Number.isInteger(end)) ranges.push({ id, start, end })
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start) // Twitch groups by emote, but we need left-to-right order

  const parts: MessagePart[] = []
  let cursor = 0 // how much of the text we've already consumed
  for (const r of ranges) {
    if (r.start < cursor || r.end >= chars.length) continue // ignore overlapping/out-of-range data
    if (r.start > cursor) pushText(parts, chars.slice(cursor, r.start).join('')) // text before the emote
    parts.push({ type: 'emote', value: chars.slice(r.start, r.end + 1).join(''), url: emoteUrl(r.id), source: 'native' })
    cursor = r.end + 1
  }
  if (cursor < chars.length) pushText(parts, chars.slice(cursor).join('')) // text after the last emote
  return parts
}

/** Read the `badges` tag ("moderator/1,subscriber/12") into Badge objects (images are added later). */
function badgesFrom(tags: Record<string, string>): Badge[] {
  return (tags['badges'] ?? '')
    .split(',')
    .filter(Boolean)
    .map((id) => ({ id, label: BADGE_LABELS[id.split('/')[0]] ?? '' }))
}

function authorFrom(tags: Record<string, string>, nick: string): ChatMessage['author'] {
  const name = tags['display-name'] || nick
  return { id: tags['user-id'] || undefined, name, color: tags['color'] || fallbackColor(name), badges: badgesFrom(tags) }
}

/** "/me waves" arrives as "\x01ACTION waves\x01". Strip the wrapper and report that it was an action. */
function stripAction(text: string): { text: string; isAction: boolean } {
  if (text.startsWith('\x01ACTION ') && text.endsWith('\x01')) return { text: text.slice(8, -1), isAction: true }
  return { text, isAction: false }
}

/** Fallback id for lines Twitch didn't give one (random suffix avoids collisions). */
const newId = (kind: string, channel: string, ts: number) => `${kind}-${channel}-${ts}-${Math.random().toString(36).slice(2, 8)}`
/** The channel a line belongs to: first param is "#channelname". */
const channelOf = (irc: IrcMessage) => irc.params[0]?.replace(/^#/, '')

// ===================================================================================================
// Normal chat messages (PRIVMSG)
// ===================================================================================================

export function privmsgToChatMessage(irc: IrcMessage): ChatMessage | null {
  const { tags } = irc
  const channel = channelOf(irc)
  if (!channel || irc.trailing === undefined) return null

  const { text, isAction } = stripAction(irc.trailing)
  const nick = irc.prefix?.split('!')[0] ?? 'unknown' // prefix is "nick!nick@nick.tmi.twitch.tv"
  const author = authorFrom(tags, nick)
  const bits = Number(tags['bits']) // present only on cheers

  return {
    id: tags['id'] || newId('msg', channel, Date.now()),
    platform: 'twitch',
    channelId: channel,
    author,
    parts: buildParts(text, tags['emotes'] ?? ''),
    timestamp: Number(tags['tmi-sent-ts']) || Date.now(),
    meta: {
      isMod: tags['mod'] === '1' || author.badges.some((b) => b.id.startsWith('moderator/')),
      isSub: tags['subscriber'] === '1',
      isAction: isAction || undefined,
      bits: bits > 0 ? bits : undefined
    }
  }
}

// ===================================================================================================
// Channel events (USERNOTICE): subs, gifts, raids, announcements...
// ===================================================================================================

/**
 * Maps Twitch's `msg-id` to our EventType. Unknown ids fall back to 'notice' (still shown if Twitch
 * supplied text). To support a new Twitch event, add a line here; to restyle an event type, see
 * renderer/src/lib/events.ts.
 */
const EVENT_TYPES: Record<string, EventType> = {
  sub: 'sub',
  resub: 'resub',
  extendsub: 'sub',
  subgift: 'subgift',
  anonsubgift: 'subgift',
  submysterygift: 'giftbomb',
  anonsubmysterygift: 'giftbomb',
  giftpaidupgrade: 'sub',
  anongiftpaidupgrade: 'sub',
  primepaidupgrade: 'sub',
  standardpayforward: 'sub',
  communitypayforward: 'sub',
  raid: 'raid',
  announcement: 'announcement',
  viewermilestone: 'milestone',
  bitsbadgetier: 'milestone'
}

/** Colours the announcement sender can pick (Twitch gives the colour's NAME, we map it to a hex value). */
const ANNOUNCEMENT_COLORS: Record<string, string> = {
  PRIMARY: '#9b6bff',
  BLUE: '#5aa9ff',
  GREEN: '#4ade80',
  ORANGE: '#ffa94d',
  PURPLE: '#c084fc'
}

/**
 * Twitch supplies a ready-made English sentence in the `system-msg` tag for most events
 * ("Foo subscribed at Tier 1. They've subscribed for 8 months!"), so we show that instead of
 * building sentences ourselves. Returns null for notices with nothing displayable.
 */
export function usernoticeToChatMessage(irc: IrcMessage): ChatMessage | null {
  const { tags } = irc
  const channel = channelOf(irc)
  if (!channel) return null

  const msgId = tags['msg-id'] ?? ''
  const system = (tags['system-msg'] ?? '').trim()
  const isAnnouncement = msgId === 'announcement'
  if (!system && !isAnnouncement) return null // nothing we could show

  // For USERNOTICE the line's prefix is just "tmi.twitch.tv", so the user's name comes from the `login` tag.
  const nick = tags['login'] || irc.prefix?.split('!')[0] || 'unknown'
  const { text } = stripAction(irc.trailing ?? '') // the viewer's own message, e.g. on a resub
  const ts = Number(tags['tmi-sent-ts']) || Date.now()

  return {
    id: tags['id'] || newId('evt', channel, ts),
    platform: 'twitch',
    channelId: channel,
    author: authorFrom(tags, nick),
    parts: text ? buildParts(text, tags['emotes'] ?? '') : [],
    timestamp: ts,
    event: {
      type: EVENT_TYPES[msgId] ?? 'notice',
      title: isAnnouncement ? '' : system, // an announcement's text is the message itself, not a title
      color: isAnnouncement ? ANNOUNCEMENT_COLORS[tags['msg-param-color'] ?? ''] : undefined
    }
  }
}

// ===================================================================================================
// Moderation (CLEARMSG / CLEARCHAT)
// ===================================================================================================

/** CLEARMSG: a single message was deleted. `target-msg-id` is the id of that message. */
export function clearmsgToAction(irc: IrcMessage): ModerationEvent | null {
  const channel = channelOf(irc)
  const messageId = irc.tags['target-msg-id']
  if (!channel || !messageId) return null
  return { type: 'delete-message', platform: 'twitch', channelId: channel, messageId }
}

/**
 * CLEARCHAT does three different things depending on its contents:
 *   - trailing text = a username, with `ban-duration` tag -> that user was timed out
 *   - trailing text = a username, no `ban-duration`      -> that user was banned
 *   - no trailing text                                    -> the whole chat was cleared
 * Returns the change to apply to existing messages (`action`, absent when chat was cleared) plus a
 * small note row (`notice`) to show in the feed.
 */
export function parseClearChat(irc: IrcMessage): { action?: ModerationEvent; notice: ChatMessage } | null {
  const { tags } = irc
  const channel = channelOf(irc)
  if (!channel) return null

  const login = irc.trailing?.trim()
  const duration = Number(tags['ban-duration']) // NaN when absent, which makes `duration > 0` false
  const ts = Number(tags['tmi-sent-ts']) || Date.now()
  // The note row has no author: it's a system message.
  const base = {
    id: newId('mod', channel, ts),
    platform: 'twitch' as const,
    channelId: channel,
    author: { name: '', badges: [] },
    parts: [],
    timestamp: ts
  }

  if (!login) {
    return { notice: { ...base, event: { type: 'moderation', title: 'Chat was cleared by a moderator' } } }
  }
  const isTimeout = duration > 0
  const userId = tags['target-user-id'] || undefined
  return {
    action: {
      type: 'clear-user',
      platform: 'twitch',
      channelId: channel,
      userId,
      login: login.toLowerCase(),
      durationSec: isTimeout ? duration : undefined
    },
    notice: {
      ...base,
      event: {
        type: 'moderation',
        title: isTimeout ? `${login} was timed out for ${formatDuration(duration)}` : `${login} was banned`,
        target: { userId, login } // lets the UI offer "Undo" (unban) on this row
      }
    }
  }
}
