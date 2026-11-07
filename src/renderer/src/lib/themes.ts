/**
 * renderer/src/lib/themes.ts   (the colour themes)
 *
 * WHAT: Defines every built-in theme and how to switch between them.
 *
 * HOW THEMING WORKS
 *   styles.css never contains literal colours for the app chrome; it uses CSS variables such as
 *   `var(--bg)` and `var(--text)`. A theme is just a set of values for those variables. `applyTheme`
 *   writes them onto the page's root element, and every rule that uses them recolours instantly.
 *   Platform colours (lib/platforms.ts) and event colours (lib/events.ts) are separate and the same
 *   in every theme.
 *
 * TO ADD A THEME
 *   1. Add its id to `ThemeId` and an entry to `THEMES` with a value for EVERY name in
 *      `THEME_VAR_NAMES` (TypeScript will complain if one is missing).
 *   2. Add the id to `THEME_ORDER` to control where it appears in Settings.
 *   That's all: the Settings screen lists whatever is in `THEME_ORDER`.
 *
 * COLOUR TIPS: keep body text at least 7:1 contrast against `--bg` and secondary text (`--muted`) at
 *   least 4.5:1. Settings -> Appearance previews each theme, so you can judge it by eye.
 *
 * `--accent-default` is the app's own accent (buttons, focus rings); `--on-accent` is the text colour
 * that sits ON an accent-coloured button, so it must contrast with the accent.
 */

export type ThemeId = 'plum' | 'midnight' | 'graphite' | 'daylight'

/** What the user can pick: a specific theme, or "system" to follow the operating system's light/dark setting. */
export type ThemeChoice = ThemeId | 'system'

/** The CSS variables every theme must define. */
export const THEME_VAR_NAMES = [
  '--bg', // window background
  '--panel', // raised surfaces: inputs, buttons, toolbars
  '--line', // borders and dividers
  '--text', // main text
  '--muted', // secondary text
  '--accent-default', // the app's accent colour
  '--on-accent', // text drawn on top of the accent colour
  '--link', // links inside chat
  '--ok', // "good" green text
  '--danger-text', // error text
  '--danger-soft', // soft red background (hover on dangerous buttons)
  '--danger-border', // red border (error toast)
  '--placeholder', // placeholder text inside inputs
  '--shadow' // drop-shadow colour
] as const

export type ThemeVarName = (typeof THEME_VAR_NAMES)[number]

export interface Theme {
  id: ThemeId
  label: string
  /** One short line shown on the theme's card in Settings. */
  description: string
  /** Tells the browser to draw scrollbars and form controls in a matching style. */
  colorScheme: 'dark' | 'light'
  vars: Record<ThemeVarName, string>
}

export const THEMES: Record<ThemeId, Theme> = {
  plum: {
    id: 'plum',
    label: 'Plum',
    description: 'Warm dark purple. The original look.',
    colorScheme: 'dark',
    vars: {
      '--bg': '#15121d',
      '--panel': '#1d1928',
      '--line': '#2b2639',
      '--text': '#e9e4f3',
      '--muted': '#8d86a3',
      '--accent-default': '#9b6bff',
      '--on-accent': '#14111b',
      '--link': '#8ecbff',
      '--ok': '#7ddf9a',
      '--danger-text': '#ff8a8f',
      '--danger-soft': '#5b2230',
      '--danger-border': '#7a2e3a',
      '--placeholder': '#5f5977',
      '--shadow': '#00000088'
    }
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    description: 'Cool blue-black with a sky-blue accent.',
    colorScheme: 'dark',
    vars: {
      '--bg': '#0e1420',
      '--panel': '#161e30',
      '--line': '#243049',
      '--text': '#e6ecf7',
      '--muted': '#8593ad',
      '--accent-default': '#5aa9ff',
      '--on-accent': '#0b1220',
      '--link': '#9fd0ff',
      '--ok': '#6fdc9a',
      '--danger-text': '#ff8f9a',
      '--danger-soft': '#4a1f2c',
      '--danger-border': '#7a2e3a',
      '--placeholder': '#56627c',
      '--shadow': '#00000099'
    }
  },
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral dark grey with a mint accent.',
    colorScheme: 'dark',
    vars: {
      '--bg': '#151618',
      '--panel': '#202225',
      '--line': '#30333a',
      '--text': '#ececec',
      '--muted': '#9a9da3',
      '--accent-default': '#4cc9b0',
      '--on-accent': '#0d1412',
      '--link': '#8ecbff',
      '--ok': '#7ddf9a',
      '--danger-text': '#ff8a8f',
      '--danger-soft': '#4a2229',
      '--danger-border': '#7a3a42',
      '--placeholder': '#666a72',
      '--shadow': '#00000099'
    }
  },
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    description: 'Light theme with a violet accent.',
    colorScheme: 'light',
    vars: {
      '--bg': '#f6f3fb',
      '--panel': '#ffffff',
      '--line': '#ddd6ea',
      '--text': '#241f33',
      '--muted': '#6b6480',
      '--accent-default': '#7c4dff',
      '--on-accent': '#ffffff',
      '--link': '#1d5fd1',
      '--ok': '#15803d',
      '--danger-text': '#b42318',
      '--danger-soft': '#fde4e4',
      '--danger-border': '#f0b4b4',
      '--placeholder': '#9a93ad',
      '--shadow': '#2a1f4a33'
    }
  }
}

/** The order themes are listed in Settings. */
export const THEME_ORDER: ThemeId[] = ['plum', 'midnight', 'graphite', 'daylight']

/**
 * Turn the user's choice into a concrete theme. "system" picks Plum when the operating system is in
 * dark mode and Daylight when it is in light mode.
 */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeId {
  if (choice === 'system') return systemPrefersDark ? 'plum' : 'daylight'
  return choice
}

/** Write a theme's colours onto the page. Cheap to call; every CSS rule using the variables updates immediately. */
export function applyTheme(id: ThemeId): void {
  const theme = THEMES[id]
  const root = document.documentElement
  for (const name of THEME_VAR_NAMES) root.style.setProperty(name, theme.vars[name])
  root.style.colorScheme = theme.colorScheme
  root.dataset.theme = id // handy hook if you ever need a theme-specific CSS rule: :root[data-theme='daylight'] { ... }
}
