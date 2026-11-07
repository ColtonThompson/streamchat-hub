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
import { THEME_ORDER, THEMES } from '../../lib/themes'
import { useSettingsStore } from '../../store/settingsStore'

export function AppearanceTab() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  return (
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
  )
}
