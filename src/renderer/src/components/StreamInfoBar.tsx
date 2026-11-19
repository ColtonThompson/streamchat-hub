/**
 * renderer/src/components/StreamInfoBar.tsx   (stream title + viewers above the chat)
 *
 * WHAT: A one-line bar above the feed with the stream's title, category and live viewer count, when Settings -> Chat ->
 *       "Show stream title and viewer count" is on. It follows one stream: the first channel you added, or the one picked
 *       in the Channels menu (see lib/streaminfo.ts). With several channels in the feed it names the channel the title
 *       belongs to. It renders nothing when there are no channels, so it takes no space.
 */
import { channelTag } from '../../../shared/channels'
import { sourceLabel } from '../lib/channelbreaks'
import { allChannels, formatViewers, streamInfoTarget } from '../lib/streaminfo'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { useStreamInfoStore } from '../store/streamInfoStore'

export function StreamInfoBar() {
  const show = useSettingsStore((s) => s.showStreamInfo)
  const channels = useChatStore((s) => s.channels)
  const titleSource = useChatStore((s) => s.titleSource)
  const info = useStreamInfoStore((s) => s.info)

  const target = streamInfoTarget(show, channels, titleSource)
  // Ignore info that belongs to a stream no longer selected (it is cleared a moment later by the main process).
  if (!target || !info || info.platform !== target.platform || info.source !== target.source) return null

  const where = info.platform === 'twitch' ? channelTag({ platform: 'twitch', channelId: info.source }) : info.source.startsWith('@') ? info.source : ''
  const several = allChannels(channels).length > 1 // then say which channel this title is for
  const label = info.title ? info.title : info.note ?? (info.live ? 'Live' : `${where || 'This stream'} is offline`)

  return (
    <section className="streaminfo" aria-label="Stream info" data-live={info.live}>
      <span className="streaminfo-state">{info.live ? 'LIVE' : 'OFFLINE'}</span>
      {several && <span className="streaminfo-where">{where || sourceLabel(info.platform, info.source)}</span>}
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
