/**
 * renderer/src/components/MessageRow.tsx   (one row in the feed)
 *
 * WHAT: Draws a single ChatMessage. Three kinds of row share this component:
 *   - a chat line:        [channel] [badges] [bits] Author  text and emotes
 *   - an event:           [Label pill]  Summary text, plus the viewer's message underneath if any
 *   - a moderation note:  a small muted italic line ("X was timed out for 10m")
 *
 * REMOVED MESSAGES: when a moderator deletes a message (or times out/bans its author) the row shows
 *   a muted placeholder instead of the text. Click the row (or press Enter) to peek at the original,
 *   shown struck-through.
 *
 * TIMESTAMP + NAME COLOUR: when the user turns timestamps on (Settings -> Chat), a muted time is shown
 *   first on every row. Usernames are passed through `readableOn` so a viewer's chosen colour never
 *   disappears into the current theme's background.
 *
 * STYLING: This file decides WHAT to show and sets `data-*` attributes (data-event, data-removed,
 *   data-highlight...). The look comes from CSS rules keyed on those attributes in styles.css. To
 *   restyle something, change the CSS, not this file.
 *
 * PERFORMANCE: wrapped in `memo`, so a row re-renders only if its own props change. Important
 *   because the feed can hold thousands of rows and new messages arrive constantly.
 *
 * @MENTIONS: "@name" in message text is drawn as a chip (MentionChip.tsx); a mention of the signed-in
 *   user gets a stronger look. The `me` prop carries the user's login.
 *
 * Sub-components in this file: EmoteImg, BadgeIcon, Part.
 */
import { memo, useState, type KeyboardEvent } from 'react'
import type { Badge, ChatMessage, MessagePart } from '../../../shared/types'
import { readableOn, textOn } from '../lib/color'
import { EVENT_META, REMOVED_TEXT } from '../lib/events'
import { splitMentions } from '../lib/mentions'
import { PLATFORM_META } from '../lib/platforms'
import { formatTime, type TimeStyle } from '../lib/time'
import { MentionChip } from './MentionChip'
import { ModToolbar } from './ModToolbar'

/** An emote image that falls back to the emote's name as text if the image fails to load. */
function EmoteImg({ src, name, title, overlay }: { src: string; name: string; title: string; overlay?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="emote-fallback">{name}</span>
  return (
    <img
      className={overlay ? 'emote overlay' : 'emote'}
      src={src}
      alt={name}
      title={title}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/** The badge image when we have one, otherwise a small text pill, or nothing for badges we can't name. */
function BadgeIcon({ badge }: { badge: Badge }) {
  const [failed, setFailed] = useState(false)
  if (badge.url && !failed) {
    return (
      <img
        className="badge-img"
        src={badge.url}
        alt={badge.label || badge.id}
        title={badge.title ?? badge.label}
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  return badge.label ? <span className="badge">{badge.label}</span> : null
}

/** Names shown in an emote's hover tooltip. */
const SOURCE_LABEL = { native: 'Twitch', '7tv': '7TV', bttv: 'BTTV', ffz: 'FFZ', youtube: 'YouTube' } as const

/** Renders one piece of a message: plain text, an emote (with any stacked overlays), or a link. */
function Part({ part, me }: { part: MessagePart; me?: string }) {
  switch (part.type) {
    case 'emote': {
      const title = part.source ? `${part.value} (${SOURCE_LABEL[part.source]})` : part.value
      const base = <EmoteImg src={part.url} name={part.value} title={title} />
      if (!part.overlays?.length) return base
      // Zero-width emotes: wrap in a relatively-positioned box and absolutely position overlays on top.
      return (
        <span className="emote-stack">
          {base}
          {part.overlays.map((o, i) => (
            <EmoteImg key={i} src={o.url} name={o.value} title={o.value} overlay />
          ))}
        </span>
      )
    }
    case 'link':
      return (
        // Opens in the real browser (main/index.ts intercepts it). stopPropagation: clicking a link
        // inside a removed row shouldn't also toggle the row.
        <a href={part.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {part.value}
        </a>
      )
    default:
      // Plain text: any "@name" in it is drawn as a chip (see lib/mentions.ts).
      return (
        <>
          {splitMentions(part.value).map((piece, i) =>
            piece.kind === 'mention' ? <MentionChip key={i} text={piece.value} name={piece.name} me={me} /> : piece.value
          )}
        </>
      )
  }
}

interface Props {
  msg: ChatMessage
  /** 0 or 1: alternates row to row so neighbouring messages are easy to tell apart (see ChatFeed). */
  alt: 0 | 1
  /** Show a "#channel" tag (when several Twitch channels are being read). */
  showChannel?: boolean
  /** 'off', or how to format the time shown at the start of the row (see lib/time.ts). */
  timeStyle: TimeStyle
  /** The current theme's background colour ("#rrggbb"), used to keep usernames readable. */
  themeBg: string
  /** Your lowercase Twitch login (undefined when signed out): mentions of you get a stronger chip. */
  me?: string
}

export const MessageRow = memo(function MessageRow({ msg, alt, showChannel, timeStyle, themeBg, me }: Props) {
  const [revealed, setRevealed] = useState(false) // has the user clicked a removed row open?
  const platform = PLATFORM_META[msg.platform]
  const ev = msg.event
  const evMeta = ev && EVENT_META[ev.type]
  const hidden = !!msg.removed && !revealed // removed by a moderator and not clicked open

  const highlight = msg.meta?.superChat ? 'super' : msg.meta?.bits ? 'bits' : undefined

  // The viewer's chosen name colour, nudged only if it would be hard to read on this theme.
  const nameColor = readableOn(msg.author.color, themeBg)
  const timeEl = timeStyle !== 'off' && <span className="msg-time">{formatTime(msg.timestamp, timeStyle)}</span>

  const authorEl = (
    <span className="author" style={{ color: nameColor }}>
      {msg.author.name}
    </span>
  )
  const content = msg.parts.map((p, i) => <Part key={i} part={p} me={me} />)
  const textEl = hidden ? (
    <span className="removed-note">{REMOVED_TEXT[msg.removed!]}</span>
  ) : (
    <span className={msg.removed ? 'text struck' : 'text'} style={msg.meta?.isAction ? { color: nameColor } : undefined}>
      {content}
    </span>
  )

  // Only removed rows are clickable. `role="button"` + tabIndex make them usable with the keyboard too.
  const interactive = msg.removed
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: revealed ? 'Click to hide' : 'Click to show the removed message',
        onClick: () => setRevealed((v) => !v),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setRevealed((v) => !v)
          }
        }
      }
    : {}

  // Choose the body for this kind of row.
  let body
  if (ev?.type === 'moderation' || (ev?.type === 'notice' && msg.parts.length === 0 && !ev.title)) {
    body = (
      <>
        {timeEl}
        <span className="event-note">{ev.title}</span>
      </>
    )
  } else if (ev && evMeta) {
    body = (
      <>
        {timeEl}
        {showChannel && <span className="chan-tag">#{msg.channelId}</span>}
        <span className="event-tag">{evMeta.label}</span>
        {ev.title && <strong className="event-title">{ev.title}</strong>}
        {msg.parts.length > 0 && (
          <div className="event-msg">
            {authorEl} {textEl}
          </div>
        )}
      </>
    )
  } else {
    body = (
      <>
        {timeEl}
        {showChannel && <span className="chan-tag">#{msg.channelId}</span>}
        {msg.author.badges.map((b) => (
          <BadgeIcon key={b.id} badge={b} />
        ))}
        {msg.meta?.bits && <span className="bits-pill">{msg.meta.bits} bits</span>}
        {msg.meta?.superChat && (
          <span
            className="super-pill"
            style={{ ['--tier' as string]: msg.meta.superChat.color, color: textOn(msg.meta.superChat.color) }}
          >
            {msg.meta.superChat.label}
          </span>
        )}
        {authorEl}
        {textEl}
      </>
    )
  }

  return (
    <div
      className="msg"
      data-alt={alt}
      data-highlight={highlight}
      data-event={ev?.type}
      data-removed={hidden || undefined}
      data-action={msg.meta?.isAction}
      // CSS custom properties: lets styles.css use var(--accent) / var(--event) for this row's colours.
      style={{ ['--accent' as string]: platform.color, ['--event' as string]: ev?.color ?? evMeta?.color }}
      {...interactive}
    >
      <span className="msg-platform" title={platform.label} aria-label={platform.label}>
        {platform.glyph}
      </span>
      <div className="msg-body">{body}</div>
      <ModToolbar msg={msg} />
    </div>
  )
})
