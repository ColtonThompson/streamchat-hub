/**
 * renderer/src/components/StreamInfoBar.tsx   (stream title + viewers above the chat)
 *
 * WHAT: A one-line bar above the feed with the stream's title, category and live viewer count, shown only
 *       when exactly one stream is being read and Settings -> Chat -> "Show stream title and viewer count" is on.
 *       It renders nothing otherwise (see lib/streaminfo.ts for the rule), so it takes no space.
 */
import { channelTag } from '../../../shared/channels'
import { formatViewers, streamInfoTarget } from '../lib/streaminfo'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { useStreamInfoStore } from '../store/streamInfoStore'

export function StreamInfoBar() {
  const show = useSettingsStore((s) => s.showStreamInfo)
  const enabled = useChatStore((s) => s.enabled)
  const channels = useChatStore((s) => s.channels)
  const info = useStreamInfoStore((s) => s.info)

  const target = streamInfoTarget(show, enabled, channels)
  // Ignore info that belongs to a stream no longer selected (it is cleared a moment later by the main process).
  if (!target || !info || info.platform !== target.platform || info.source !== target.source) return null

  const where = info.platform === 'twitch' ? channelTag({ platform: 'twitch', channelId: info.source }) : info.source.startsWith('@') ? info.source : ''
  const label = info.title ? info.title : info.note ?? (info.live ? 'Live' : `${where || 'This stream'} is offline`)

  return (
    <section className="streaminfo" aria-label="Stream info" data-live={info.live}>
      <span className="streaminfo-state">{info.live ? 'LIVE' : 'OFFLINE'}</span>
      <span className="streaminfo-title" title={info.title ?? undefined}>
        {label}
      </span>
      {info.game && <span className="streaminfo-game">{info.game}</span>}
      {info.live && info.viewers !== undefined && (
        <span className="streaminfo-viewers" title="Viewers watching now">
          {formatViewers(info.viewers)} watching
        </span>
      )}
    </section>
  )
}
