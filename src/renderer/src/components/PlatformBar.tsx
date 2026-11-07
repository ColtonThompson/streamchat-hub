/**
 * renderer/src/components/PlatformBar.tsx   (the control panel at the top)
 *
 * WHAT: Platform on/off chips, the Twitch and YouTube channel boxes, and the small tool buttons
 *       (pin on top, show events, clear, settings).
 *
 * Account sign-in used to live here; it now lives in Settings -> Accounts to keep this bar compact.
 *
 * Each chip shows connection status with a coloured dot (grey = off, pulsing = connecting,
 * glowing = connected, red = error); hovering shows the status detail. Clicking calls
 * `togglePlatform` in the store, which asks the main process to connect or disconnect.
 */
import { PLATFORMS } from '../../../shared/types'
import { PLATFORM_META } from '../lib/platforms'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { ChannelInput } from './ChannelInput'

export function PlatformBar() {
  // Each line reads ONE piece of state, so this component only re-renders when those change.
  const enabled = useChatStore((s) => s.enabled)
  const status = useChatStore((s) => s.status)
  const toggle = useChatStore((s) => s.togglePlatform)
  const alwaysOnTop = useChatStore((s) => s.alwaysOnTop)
  const toggleTop = useChatStore((s) => s.toggleAlwaysOnTop)
  const clear = useChatStore((s) => s.clear)
  const showEvents = useChatStore((s) => s.showEvents)
  const toggleEvents = useChatStore((s) => s.toggleEvents)
  const openSettings = useSettingsStore((s) => s.openPanel)

  return (
    <header className="bar">
      <div className="chips" role="group" aria-label="Platforms">
        {PLATFORMS.map((p) => {
          const meta = PLATFORM_META[p]
          const st = status[p].state
          return (
            <button
              key={p}
              className="chip"
              data-on={enabled[p]} // CSS styles the chip via these data-* attributes (see styles.css)
              data-state={st}
              style={{ ['--accent' as string]: meta.color }} // passes the platform colour to CSS
              onClick={() => toggle(p)}
              aria-pressed={enabled[p]}
              title={`${meta.label}: ${status[p].detail ?? st}`}
            >
              <span className="chip-dot" />
              {meta.label}
            </button>
          )
        })}
      </div>
      {/* One box per platform that has a real adapter; the others still use the mock feed. */}
      <div className="channel-row">
        <ChannelInput platform="twitch" />
        <ChannelInput platform="youtube" />
      </div>
      <div className="tools">
        <button className="tool" data-on={alwaysOnTop} onClick={toggleTop} aria-pressed={alwaysOnTop}>
          Pin on top
        </button>
        <button className="tool" data-on={showEvents} onClick={toggleEvents} aria-pressed={showEvents}>
          Show events
        </button>
        <button className="tool" onClick={clear}>
          Clear
        </button>
        <button className="tool" onClick={() => openSettings()} title="Themes, timestamps, blacklist and accounts">
          {/* A small "sliders" icon. `currentColor` makes it follow the button's text colour. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
          Settings
        </button>
      </div>
    </header>
  )
}
