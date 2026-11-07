/**
 * main/adapters/youtube/parse.ts   (YouTube chat actions -> app messages)
 *
 * WHAT: Converts what YouTube's chat sends into the app's `ChatMessage` / `ModerationEvent` shapes.
 *       It is PURE (no network, no timers), so it is easy to test with saved samples.
 *
 * WHAT YOUTUBE SENDS: each poll returns a list of "actions". Each action is an object with ONE key
 * naming what happened, e.g.
 *     { addChatItemAction: { item: { liveChatTextMessageRenderer: { id, authorName, message, ... } } } }
 *     { removeChatItemAction: { targetItemId: "..." } }
 * The names ending in "Renderer" are the different kinds of chat row (text message, Super Chat,
 * membership...). The shapes are YouTube's internal ones (not a published API), so `parseActions`
 * is written defensively: every field is read through small helpers that return "nothing" instead of
 * crashing when a field is missing or has changed shape.
 *
 * WHEN YOUTUBE CHANGES SOMETHING: unknown action kinds are reported through `ctx.onUnknown` (the
 * adapter logs each kind once as "[youtube] unhandled ..."). To support a new kind, add a branch in
 * `parseItem` (a row) or `parseAction` (a non-row action).
 *
 * HOW IT FITS: used by adapters/youtube/index.ts. Nothing else imports this file.
 */
import type { Badge, ChatMessage, FeedItem, MessagePart } from '../../../shared/types'

/** What the YouTube parser produces: a row, or a moderation change (live poll/prediction state is Twitch-only). */
export type ChatItem = Exclude<FeedItem, { kind: 'activity' }>

type Rec = Record<string, unknown>

// ------------------------------------------------------------------------- safe field access
// YouTube's JSON is deeply nested and any level can be missing. These helpers turn "missing or the
// wrong type" into undefined / [] / '' so the code below can stay readable.

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const rec = (v: unknown): Rec | undefined => (isRec(v) ? v : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** The text of a "simpleText" or "runs" text object, e.g. {simpleText: "$5.00"} or {runs: [{text: "a"}, ...]}. */
export function plainText(v: unknown): string {
  const r = rec(v)
  if (!r) return ''
  if (typeof r.simpleText === 'string') return r.simpleText
  return list(r.runs)
    .map((run) => str(rec(run)?.text) ?? '')
    .join('')
}

/** Thumbnails come as a list of sizes, smallest first. We take the biggest. Returns an absolute URL. */
function bestThumbnail(v: unknown): string | undefined {
  const thumbs = list(rec(v)?.thumbnails)
  const url = str(rec(thumbs[thumbs.length - 1])?.url)
  if (!url) return undefined
  return url.startsWith('//') ? 'https:' + url : url
}

/** YouTube writes colours as 32-bit ARGB integers (e.g. 4279592384). Returns "#rrggbb", or undefined. */
export function argbToHex(n: unknown): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')
}

// -------------------------------------------------------------------------------- name colours

/**
 * YouTube viewers have no chosen name colour (Twitch viewers do), so we invent a STABLE one from the
 * viewer's channel id: the same person is always the same colour, which makes a busy chat much easier
 * to follow. `readableOn` (renderer) nudges it if it clashes with the theme.
 */
export function nameColor(authorId: string | undefined): string | undefined {
  if (!authorId) return undefined
  let h = 0
  for (let i = 0; i < authorId.length; i++) h = (h * 31 + authorId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 65% 62%)`
}

// ------------------------------------------------------------------------------ message text

/** YouTube wraps outgoing links in "youtube.com/redirect?q=<real url>". Return the real one. */
function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('youtube.com') && u.pathname === '/redirect') return u.searchParams.get('q') ?? url
  } catch {
    /* not a parseable URL: use it as is */
  }
  return url
}

/** Add text, merging into the previous part when that is also text (avoids many tiny parts). */
function pushText(parts: MessagePart[], text: string): void {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', value: last.value + text }
  else parts.push({ type: 'text', value: text })
}

/**
 * A message is a list of "runs": plain text, links, or emoji.
 *   - {text: "hello "}
 *   - {text: "example.com", navigationEndpoint: {urlEndpoint: {url}}}        -> link
 *   - {emoji: {emojiId: "😀", ...}}                                          -> a normal Unicode emoji: plain text
 *   - {emoji: {emojiId: "UC.../abc", isCustomEmoji: true, image: {...}}}     -> a channel's custom emote: an image
 */
export function runsToParts(runs: unknown): MessagePart[] {
  const parts: MessagePart[] = []
  for (const run of list(runs)) {
    const r = rec(run)
    if (!r) continue

    const emoji = rec(r.emoji)
    if (emoji) {
      const id = str(emoji.emojiId) ?? ''
      // Custom emote ids look like "<channel id>/<emote id>"; Unicode ones are the character itself.
      const custom = emoji.isCustomEmoji === true || r.isCustomEmoji === true || r.isCustomeEmoji === true || id.includes('/')
      const url = custom ? bestThumbnail(emoji.image) : undefined
      if (custom && url) {
        // Name for the tooltip/alt text: the first shortcut (":_hugs:") or the accessibility label.
        const name = str(list(emoji.shortcuts)[0]) ?? str(rec(rec(rec(emoji.image)?.accessibility)?.accessibilityData)?.label) ?? 'emote'
        parts.push({ type: 'emote', value: name, url, source: 'youtube' })
      } else {
        pushText(parts, id) // Unicode emoji (or a custom one with no image: show its id rather than nothing)
      }
      continue
    }

    const text = str(r.text)
    if (text === undefined) continue
    const target = str(rec(rec(r.navigationEndpoint)?.urlEndpoint)?.url)
    if (target && /^https?:\/\//i.test(unwrapRedirect(target))) {
      parts.push({ type: 'link', value: text, url: unwrapRedirect(target) })
    } else {
      pushText(parts, text)
    }
  }
  return parts
}

// ----------------------------------------------------------------------------------- authors

/** Badge icon types YouTube uses for the special roles. */
const ROLE_BADGES: Record<string, { id: string; label: string; title: string }> = {
  OWNER: { id: 'owner', label: 'OWNER', title: 'Channel owner' },
  MODERATOR: { id: 'moderator', label: 'MOD', title: 'Moderator' },
  VERIFIED: { id: 'verified', label: '✓', title: 'Verified' }
}

function parseAuthor(r: Rec): { author: ChatMessage['author']; isMod: boolean; isMember: boolean } {
  const badges: Badge[] = []
  let isMod = false
  let isMember = false
  for (const entry of list(r.authorBadges)) {
    const b = rec(rec(entry)?.liveChatAuthorBadgeRenderer)
    if (!b) continue
    const iconType = str(rec(b.icon)?.iconType)
    const role = iconType ? ROLE_BADGES[iconType] : undefined
    if (role) {
      badges.push({ id: role.id, label: role.label, title: role.title })
      if (iconType === 'OWNER' || iconType === 'MODERATOR') isMod = true
    } else if (b.customThumbnail) {
      // A membership badge: a small image chosen by the channel (it changes with how long you've been a member).
      isMember = true
      badges.push({ id: 'member', label: 'MEMBER', url: bestThumbnail(b.customThumbnail), title: str(b.tooltip) ?? 'Member' })
    }
  }
  const id = str(r.authorExternalChannelId)
  return { author: { id, name: plainText(r.authorName) || 'Unknown', color: nameColor(id), badges }, isMod, isMember }
}

/** YouTube timestamps are microseconds since 1970 as a string. Ours are milliseconds. */
function timestampOf(r: Rec): number {
  const usec = Number(str(r.timestampUsec))
  return Number.isFinite(usec) && usec > 0 ? Math.round(usec / 1000) : Date.now()
}

// -------------------------------------------------------------------------------------- rows

interface Ctx {
  /** The stream's video id. Used as the message's `channelId` (what moderation events match on). */
  videoId: string
  /** Look up a viewer's display name from an earlier message (used to word "X was removed" notes). */
  nameOf?: (authorId: string) => string | undefined
  /** Called with the name of any action or row kind we don't handle (so the adapter can log it). */
  onUnknown?: (kind: string) => void
}
export type ParseContext = Ctx

/** Row kinds that are deliberately not shown (system text, gift receipts, pinned banners...). */
const IGNORED = new Set([
  'liveChatPlaceholderItemRenderer',
  'liveChatViewerEngagementMessageRenderer', // "Welcome to live chat! Remember to guard your privacy..."
  'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer', // one per recipient of a gift: the purchase row already covers it
  'liveChatModeChangeMessageRenderer',
  'liveChatBannerRenderer',
  'addLiveChatTickerItemAction', // the pinned Super Chat ticker; the Super Chat itself is also sent as a row
  'addBannerToLiveChatCommand',
  'removeBannerForLiveChatCommand',
  'showLiveChatActionPanelAction',
  'closeLiveChatActionPanelAction',
  'updateLiveChatPollAction',
  'showLiveChatTooltipCommand',
  'replayChatItemAction'
])

function base(id: string, r: Rec, ctx: Ctx): Omit<ChatMessage, 'parts' | 'author'> {
  return { id, platform: 'youtube', channelId: ctx.videoId, timestamp: timestampOf(r) }
}

/** One chat row (the `item` inside `addChatItemAction`) -> a ChatMessage, or undefined if not shown. */
function parseItem(item: unknown, ctx: Ctx): ChatMessage | undefined {
  const it = rec(item)
  if (!it) return undefined
  const kind = Object.keys(it)[0]
  const r = rec(it[kind])
  if (!kind || !r) return undefined
  const id = str(r.id)

  switch (kind) {
    case 'liveChatTextMessageRenderer': {
      if (!id) return undefined
      const { author, isMod, isMember } = parseAuthor(r)
      return { ...base(id, r, ctx), author, parts: runsToParts(rec(r.message)?.runs), meta: { isMod, isSub: isMember } }
    }

    case 'liveChatPaidMessageRenderer': {
      // A Super Chat: an amount, a tier colour, and an optional message.
      if (!id) return undefined
      const { author, isMod, isMember } = parseAuthor(r)
      return {
        ...base(id, r, ctx),
        author,
        parts: runsToParts(rec(r.message)?.runs),
        meta: {
          isMod,
          isSub: isMember,
          superChat: { label: plainText(r.purchaseAmountText) || 'Super Chat', color: argbToHex(r.headerBackgroundColor) ?? argbToHex(r.bodyBackgroundColor) }
        }
      }
    }

    case 'liveChatPaidStickerRenderer': {
      // A Super Sticker: an amount and a picture instead of text.
      if (!id) return undefined
      const { author, isMod, isMember } = parseAuthor(r)
      const sticker = rec(r.sticker)
      const url = bestThumbnail(sticker)
      const label = str(rec(rec(sticker?.accessibility)?.accessibilityData)?.label) ?? 'Super Sticker'
      return {
        ...base(id, r, ctx),
        author,
        parts: url ? [{ type: 'emote', value: label, url, source: 'youtube' }] : [],
        meta: { isMod, isSub: isMember, superChat: { label: plainText(r.purchaseAmountText) || 'Super Sticker', color: argbToHex(r.moneyChipBackgroundColor) } }
      }
    }

    case 'liveChatMembershipItemRenderer': {
      // A new member, or a membership milestone ("Member for 6 months") with an optional message.
      if (!id) return undefined
      const { author } = parseAuthor(r)
      const milestone = plainText(r.headerPrimaryText) // empty for a brand-new member
      const sub = plainText(r.headerSubtext)
      const title = milestone ? `${author.name}: ${milestone}.` : `${author.name} became a member. ${sub}`.trim()
      return { ...base(id, r, ctx), author, parts: runsToParts(rec(r.message)?.runs), event: { type: 'member', title } }
    }

    case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer': {
      // Someone bought gift memberships for the community. The text lives in a nested header.
      if (!id) return undefined
      const header = rec(r.header)?.liveChatSponsorshipsHeaderRenderer
      const h = rec(header) ?? {}
      const name = plainText(h.authorName) || plainText(r.authorName) || 'Someone'
      const what = plainText(h.primaryText) // e.g. "Sent 5 Channel gift memberships"
      const count = Number(/(\d+)/.exec(what)?.[1] ?? 1)
      const authorId = str(r.authorExternalChannelId)
      return {
        ...base(id, r, ctx),
        author: { id: authorId, name, color: nameColor(authorId), badges: [] },
        parts: [],
        event: { type: count > 1 ? 'giftbomb' : 'subgift', title: `${name}: ${what || 'gifted memberships'}.` }
      }
    }

    default:
      if (!IGNORED.has(kind)) ctx.onUnknown?.(kind)
      return undefined
  }
}

// ------------------------------------------------------------------------------------ actions

/** Everything non-row that YouTube can say about removed content. */
function parseRemoval(kind: string, a: Rec, ctx: Ctx): ChatItem[] | undefined {
  switch (kind) {
    case 'removeChatItemAction': // a message was deleted (older shape)
    case 'markChatItemAsDeletedAction': { // a message was deleted (newer shape; carries "[message deleted]" text we don't need)
      const messageId = str(a.targetItemId)
      return messageId ? [{ kind: 'moderation', action: { type: 'delete-message', platform: 'youtube', channelId: ctx.videoId, messageId } }] : []
    }

    case 'removeChatItemByAuthorAction': // a viewer was banned or timed out: all their messages go
    case 'markChatItemsByAuthorAsDeletedAction': {
      const userId = str(a.externalChannelId)
      if (!userId) return []
      // YouTube doesn't say whether it was a timeout or a ban, so the wording covers both.
      const name = ctx.nameOf?.(userId)
      const items: ChatItem[] = [
        { kind: 'moderation', action: { type: 'clear-user', platform: 'youtube', channelId: ctx.videoId, userId, login: (name ?? '').toLowerCase() } }
      ]
      if (name) {
        items.push({
          kind: 'message',
          message: {
            id: `yt-mod-${userId}-${Date.now()}`,
            platform: 'youtube',
            channelId: ctx.videoId,
            author: { name: '', badges: [] },
            parts: [],
            timestamp: Date.now(),
            event: { type: 'moderation', title: `${name} was removed from chat (timed out or banned).`, target: { userId, login: name.toLowerCase() } }
          }
        })
      }
      return items
    }
  }
  return undefined
}

/**
 * The entry point: a poll's `actions` array -> feed items, IN ORDER (a deletion must come after the
 * message it deletes, which YouTube already guarantees; we just keep the order).
 */
export function parseActions(actions: unknown, ctx: Ctx): ChatItem[] {
  const out: ChatItem[] = []
  for (const action of list(actions)) {
    const a = rec(action)
    if (!a) continue
    const kind = Object.keys(a)[0]
    const body = rec(a[kind])
    if (!kind || !body) continue

    if (kind === 'addChatItemAction' || kind === 'replaceChatItemAction') {
      // "replace" swaps a placeholder for the real row (e.g. a held message that was approved): treat it as a new row.
      const message = parseItem(kind === 'addChatItemAction' ? body.item : body.replacementItem, ctx)
      if (message) out.push({ kind: 'message', message })
      continue
    }

    const removal = parseRemoval(kind, body, ctx)
    if (removal) {
      out.push(...removal)
      continue
    }
    if (!IGNORED.has(kind)) ctx.onUnknown?.(kind)
  }
  return out
}
