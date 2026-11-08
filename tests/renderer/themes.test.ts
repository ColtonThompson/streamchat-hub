/**
 * tests/renderer/themes.test.ts
 *
 * Guards the built-in themes: every one defines every colour, text stays readable, and the light/dark
 * labels are honest. Adding a theme with a missing or unreadable colour fails here.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex } from '../../src/renderer/src/lib/color'
import { resolveTheme, THEME_ORDER, THEME_VAR_NAMES, THEMES } from '../../src/renderer/src/lib/themes'

const ratio = (a: string, b: string) => contrastRatio(parseHex(a)!, parseHex(b)!)

describe('themes', () => {
  it('lists every theme once, in order', () => {
    expect([...THEME_ORDER].sort()).toEqual(Object.keys(THEMES).sort())
    expect(new Set(THEME_ORDER).size).toBe(THEME_ORDER.length)
  })

  for (const id of THEME_ORDER) {
    describe(id, () => {
      const t = THEMES[id]

      it('has its own id and a label and description', () => {
        expect(t.id).toBe(id)
        expect(t.label).toBeTruthy()
        expect(t.description).toBeTruthy()
      })

      it('defines every CSS variable with a hex colour (and nothing extra)', () => {
        expect(Object.keys(t.vars).sort()).toEqual([...THEME_VAR_NAMES].sort())
        for (const name of THEME_VAR_NAMES) expect(t.vars[name]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
      })

      it('keeps main text easy to read on the background (WCAG AAA, 7:1)', () => {
        expect(ratio(t.vars['--text'], t.vars['--bg'])).toBeGreaterThanOrEqual(7)
        expect(ratio(t.vars['--text'], t.vars['--panel'])).toBeGreaterThanOrEqual(7)
      })

      it('keeps secondary and error text readable (AA, 4.5:1)', () => {
        expect(ratio(t.vars['--muted'], t.vars['--bg'])).toBeGreaterThanOrEqual(4.5)
        expect(ratio(t.vars['--danger-text'], t.vars['--bg'])).toBeGreaterThanOrEqual(4.5)
        expect(ratio(t.vars['--link'], t.vars['--bg'])).toBeGreaterThanOrEqual(4.5)
      })

      it('keeps text on the accent colour readable', () => {
        expect(ratio(t.vars['--on-accent'], t.vars['--accent-default'])).toBeGreaterThanOrEqual(4.5)
      })

      it('says dark or light truthfully', () => {
        const bg = parseHex(t.vars['--bg'])!
        const white = contrastRatio(bg, [255, 255, 255])
        const black = contrastRatio(bg, [0, 0, 0])
        expect(t.colorScheme).toBe(white > black ? 'dark' : 'light')
      })
    })
  }
})

describe('resolveTheme', () => {
  it('passes a specific theme through', () => {
    expect(resolveTheme('midnight', false)).toBe('midnight')
    expect(resolveTheme('daylight', true)).toBe('daylight')
  })

  it('maps "system" to plum in dark mode and daylight in light mode', () => {
    expect(resolveTheme('system', true)).toBe('plum')
    expect(resolveTheme('system', false)).toBe('daylight')
  })
})
