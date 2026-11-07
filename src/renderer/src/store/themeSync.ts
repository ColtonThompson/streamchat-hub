/**
 * renderer/src/store/themeSync.ts
 *
 * WHAT: Keeps the screen's actual colours in step with the user's theme choice.
 *
 * WHEN THE THEME NEEDS APPLYING
 *   - at startup, BEFORE the UI first draws (`initTheme`, called from main.tsx) so a light-theme user
 *     doesn't see a dark flash;
 *   - whenever the user picks another theme (`useThemeSync`, called from App.tsx);
 *   - when the choice is "System" and the operating system switches between light and dark.
 *
 * WHAT "APPLYING" MEANS (see `apply` below)
 *   1. write the theme's colours onto the page as CSS variables (lib/themes.ts `applyTheme`);
 *   2. record which theme is in use (`resolvedTheme` in the settings store) for components that need it;
 *   3. tell the main process to recolour the native title-bar strip so it matches.
 */
import { useEffect } from 'react'
import { applyTheme, resolveTheme, THEMES, type ThemeChoice } from '../lib/themes'
import { useSettingsStore } from './settingsStore'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)')

function apply(choice: ThemeChoice): void {
  const id = resolveTheme(choice, systemDark().matches)
  applyTheme(id)
  useSettingsStore.getState().setResolvedTheme(id)
  void window.api.setWindowTheme({ background: THEMES[id].vars['--bg'], foreground: THEMES[id].vars['--text'] })
}

/** Apply the saved theme immediately. Call once, before rendering. */
export function initTheme(): void {
  apply(useSettingsStore.getState().theme)
}

/** React hook: re-apply whenever the choice changes, and follow the OS when the choice is "System". */
export function useThemeSync(): void {
  const choice = useSettingsStore((s) => s.theme)
  useEffect(() => {
    apply(choice)
    const query = systemDark()
    const onSystemChange = () => {
      if (choice === 'system') apply(choice) // only "System" follows the OS; explicit choices stay put
    }
    query.addEventListener('change', onSystemChange)
    return () => query.removeEventListener('change', onSystemChange) // remove the listener when the choice changes
  }, [choice])
}
