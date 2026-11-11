/**
 * renderer/src/components/PinnedBar.tsx   (messages pinned to the top of a channel's chat)
 *
 * WHAT: When a channel pins a message, it is shown in a bar above the chat feed (below any poll cards), so it
 *       stays in view while chat scrolls. One bar per channel that has a pin. Closing a bar hides that pin;
 *       a different pin in the same channel shows again. A pin that has an end time disappears when it passes.
 *
 * DATA: `pins` in the chat store, fed by the main process: Twitch pins are polled (main/twitch/pins.ts,
 *       needs the moderation permission and being a mod of the channel); YouTube pins arrive with the chat
 *       (adapters/youtube/parse.ts). It renders NOTHING when there are no pins.
 */
import { useEffect, useState } from 'react'
import { channelTag } from '../../../shared/channels'
import { ZOOM_DEFAULT } from '../../../shared/zoom'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { Part } from './MessageRow'

export function PinnedBar() {
  const pins = useChatStore((s) => s.pins)
  const dismiss = useChatStore((s) => s.dismissPin)
  const me = useChatStore((s) => s.auth.login)?.toLowerCase()
  const chatZoom = useSettingsStore((s) => s.chatZoom)
  const entries = Object.entries(pins)

  // Wake up when the soonest timed pin expires, so it disappears without waiting for another update.
  const [now, setNow] = useState(() => Date.now())
  const nextEnd = Math.min(...entries.map(([, p]) => p.endsAt ?? Infinity))
  useEffect(() => {
    if (!Number.isFinite(nextEnd)) return
    const t = setTimeout(() => setNow(Date.now()), Math.max(250, nextEnd - Date.now() + 50))
    return () => clearTimeout(t)
  }, [nextEnd, now])

  const shown = entries.filter(([, p]) => !p.endsAt || p.endsAt > now)
  if (shown.length === 0) return null
  const several = shown.length > 1 || Object.keys(pins).length > 1

  return (
    <section className="pins" aria-label="Pinned messages" style={{ ['--chat-zoom' as string]: chatZoom / ZOOM_DEFAULT }}>
      {shown.map(([key, pin]) => (
        <article className="pin" key={key} data-platform={pin.platform}>
          <header className="pin-head">
            <span className="pin-tag">Pinned</span>
            {(several || pin.platform === 'youtube') && <span className="pin-where">{channelTag(pin)}</span>}
            {pin.pinnedBy && <span className="pin-by">by {pin.pinnedBy}</span>}
            <button className="activity-close" onClick={() => dismiss(key)} aria-label="Close this pinned message" title="Close">
              ×
            </button>
          </header>
          <p className="pin-body">
            <strong className="pin-author" style={pin.author.color ? { color: pin.author.color } : undefined}>
              {pin.author.name}
            </strong>
            {pin.parts.map((part, i) => (
              <Part key={i} part={part} me={me} />
            ))}
          </p>
        </article>
      ))}
    </section>
  )
}
