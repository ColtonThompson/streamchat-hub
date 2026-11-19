/**
 * renderer/src/components/PlatformBar.tsx   (the control bar at the top)
 *
 * WHAT: Left: the "Add channel" button, the "Channels" menu (everything you are reading; leave a channel or pick whose
 *       title is shown) and, in red, any connection problem. Right: "Show events", and icon buttons (with tooltips) for
 *       pin-on-top and clear, then the Settings cogwheel in the top right corner.
 *
 * There are no per-platform switches: a platform connects when it has a channel and disconnects when its last channel
 * is removed (chatStore.setChannels), and the channels of the last session are reconnected at startup
 * (chatStore.resume). Account sign-in lives in Settings -> Accounts.
 */
import { PLATFORMS } from '../../../shared/types'
import { PLATFORM_META } from '../lib/platforms'
import { updatePending } from '../lib/updates'
import { useUpdateStore } from '../store/updateStore'
import { useAddChannelStore } from '../store/addChannelStore'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { ChannelsMenu } from './ChannelsMenu'
import { IconButton } from './IconButton'

export function PlatformBar() {
  // Each line reads ONE piece of state, so this component only re-renders when those change.
  const enabled = useChatStore((s) => s.enabled)
  const status = useChatStore((s) => s.status)
  const alwaysOnTop = useChatStore((s) => s.alwaysOnTop)
  const toggleTop = useChatStore((s) => s.toggleAlwaysOnTop)
  const clear = useChatStore((s) => s.clear)
  const showEvents = useChatStore((s) => s.showEvents)
  const toggleEvents = useChatStore((s) => s.toggleEvents)
  const showAdd = useAddChannelStore((s) => s.show)
  const openSettings = useSettingsStore((s) => s.openPanel)
  const update = useUpdateStore((s) => updatePending(s.state)) // a new version is waiting: dot on the Settings button

  const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

  return (
    <header className="bar">
      <div className="bar-left">
        <button className="add-channel" onClick={() => showAdd()}>
          <span aria-hidden="true">+</span> Add channel
        </button>
        <ChannelsMenu />
        {PLATFORMS.filter((p) => enabled[p] && status[p].state === 'error').map((p) => (
          <span key={p} className="channels-error" role="alert">
            {PLATFORM_META[p].label}: {status[p].detail}
          </span>
        ))}
      </div>
      <div className="bar-right">
        <button className="tool" data-on={showEvents} onClick={toggleEvents} aria-pressed={showEvents} title="Show subs, raids, polls and other events in the chat">
          Show events
        </button>
        <IconButton label={alwaysOnTop ? 'Pin on top: on (keeps this window above other windows)' : 'Pin on top: keep this window above other windows'} pressed={alwaysOnTop} onClick={toggleTop}>
          <svg {...icon}>
            <path d="M9 4h6l-1 6 4 3H6l4-3-1-6zM12 13v7" />
          </svg>
        </IconButton>
        <IconButton label="Clear the chat" onClick={clear}>
          <svg {...icon}>
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
          </svg>
        </IconButton>
        <IconButton label={update ? 'Settings (a new version is available)' : 'Settings'} align="end" dot={update ? 'Update available' : undefined} onClick={() => openSettings()}>
          <svg {...icon}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </IconButton>
      </div>
    </header>
  )
}
