/**
 * renderer/src/components/FeedBreak.tsx   (the divider line when a channel joins or leaves the feed)
 *
 * WHAT: A thin line across the chat with "Joined #nightleaf" / "Left #nightleaf" / "#nightleaf went live: title" in the middle, tinted with the
 * platform's colour. It marks where the previous chat ends and the new one starts coming in. See lib/channelbreaks.ts.
 */
import { memo } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { isEndBreak } from '../lib/channelbreaks'
import { PLATFORM_META } from '../lib/platforms'
import { formatTime, type TimeStyle } from '../lib/time'

interface Props {
  msg: ChatMessage
  timeStyle: TimeStyle
}

export const FeedBreak = memo(function FeedBreak({ msg, timeStyle }: Props) {
  const title = msg.event?.title ?? ''
  return (
    <div className="feed-break" role="separator" aria-label={title} data-kind={isEndBreak(title) ? 'left' : 'joined'} style={{ ['--accent' as string]: PLATFORM_META[msg.platform].color }}>
      <span className="feed-break-line" />
      <span className="feed-break-text">
        {title}
        {timeStyle !== 'off' && <time className="feed-break-time">{formatTime(msg.timestamp, timeStyle)}</time>}
      </span>
      <span className="feed-break-line" />
    </div>
  )
})
