/**
 * renderer/src/components/settings/AppearanceTab.tsx
 *
 * WHAT: The theme picker: one card per theme (a small colour preview plus its name), and a "System"
 *       card that follows the operating system's light/dark mode.
 *
 * Choosing a card calls `setTheme`; store/themeSync.ts notices and recolours the app instantly, and
 * the choice is saved. The cards are driven by `THEME_ORDER` (lib/themes.ts), so a theme added there
 * appears here automatically.
 *
 * It's a "radio group" (exactly one choice), so each card has `role="radio"` and `aria-checked`.
 */
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../../../../shared/zoom'
import { THEME_ORDER, THEMES } from '../../lib/themes'
import { useSettingsStore } from '../../store/settingsStore'

export function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const chatZoom = useSettingsStore((s) => s.chatZoom)
  const setChatZoom = useSettingsStore((s) => s.setChatZoom)
  const zoom = useSettingsStore((s) => s.zoom)

  return (
    <>
    <section className="setting">
      <h3 className="setting-title">Theme</h3>
      <p className="setting-help">Applies instantly and is remembered. Names stay readable on every theme.</p>

      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {THEME_ORDER.map((id) => {
          const t = THEMES[id]
          return (
            <button key={id} className="theme-card" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)}>
              {/* A tiny preview drawn with the theme's OWN colours (not the current theme's). */}
              <span className="theme-swatch" style={{ background: t.vars['--bg'] }} aria-hidden="true">
                <span className="swatch-main" style={{ color: t.vars['--text'] }}>
                  Aa
                </span>
                <span style={{ background: t.vars['--panel'] }} />
                <span style={{ background: t.vars['--accent-default'] }} />
              </span>
              <span className="theme-name">{t.label}</span>
              <span className="theme-desc">{t.description}</span>
            </button>
          )
        })}

        <button className="theme-card" role="radio" aria-checked={theme === 'system'} onClick={() => setTheme('system')}>
          {/* Half dark, half light: "whichever your computer is using". */}
          <span
            className="theme-swatch"
            style={{ background: `linear-gradient(90deg, ${THEMES.plum.vars['--bg']} 50%, ${THEMES.daylight.vars['--bg']} 50%)` }}
            aria-hidden="true"
          >
            <span className="swatch-main" style={{ color: '#888' }}>
              Aa
            </span>
          </span>
          <span className="theme-name">System</span>
          <span className="theme-desc">Plum in dark mode, Daylight in light mode.</span>
        </button>
      </div>
    </section>

    <section className="setting">
      <h3 className="setting-title">Chat text size</h3>
      <p className="setting-help">
        Makes chat messages bigger or smaller (the buttons and settings stay the same size). You can also press Ctrl +, Ctrl − and Ctrl 0
        (Cmd on a Mac), or hold Ctrl and scroll over the chat.
      </p>
      <div className="zoom-control">
        <input
          className="zoom-range"
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={chatZoom}
          onChange={(e) => setChatZoom(Number(e.target.value))}
          aria-label="Chat text size"
          aria-valuetext={`${chatZoom} percent`}
        />
        <span className="zoom-value" aria-hidden="true">
          {chatZoom}%
        </span>
        <div className="segmented">
          <button onClick={() => zoom('out')} disabled={chatZoom <= ZOOM_MIN} aria-label="Smaller">
            −
          </button>
          <button onClick={() => zoom('reset')} disabled={chatZoom === ZOOM_DEFAULT}>
            Reset
          </button>
          <button onClick={() => zoom('in')} disabled={chatZoom >= ZOOM_MAX} aria-label="Bigger">
            +
          </button>
        </div>
      </div>
      <div className="zoom-preview" style={{ ['--chat-zoom' as string]: chatZoom / ZOOM_DEFAULT }} aria-hidden="true">
        <strong>StreamViewer</strong>This is how chat messages will look.
      </div>
    </section>
    </>
  )
}
