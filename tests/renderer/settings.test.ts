/**
 * tests/renderer/settings.test.ts
 *
 * Settings come back from localStorage, where they may be old, hand-edited or corrupt. `sanitizeSettings`
 * must always return something valid and never throw.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MAX_BLACKLIST_TERMS, MAX_TERM_LENGTH, normalizeTerm, pickSettings, sanitizeSettings } from '../../src/renderer/src/lib/settings'

describe('sanitizeSettings', () => {
  it('gives the defaults for missing, null or non-object input', () => {
    for (const bad of [undefined, null, 5, 'text', [], true]) {
      expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('never shares the default blacklist array between results', () => {
    const a = sanitizeSettings(null)
    a.blacklist.push('mutated')
    expect(sanitizeSettings(null).blacklist).toEqual([])
    expect(DEFAULT_SETTINGS.blacklist).toEqual([])
  })

  it('keeps valid values', () => {
    const s = sanitizeSettings({ theme: 'daylight', timestamps: '24h', timestampSeconds: true, blacklist: ['spam'], liveAlerts: false })
    expect(s).toEqual({ theme: 'daylight', timestamps: '24h', timestampSeconds: true, blacklist: ['spam'], liveAlerts: false })
  })

  it('accepts the "system" theme', () => {
    expect(sanitizeSettings({ theme: 'system' }).theme).toBe('system')
  })

  it('falls back for unknown themes, including names that exist on every object', () => {
    for (const theme of ['neon', 'toString', '__proto__', 'constructor', 7, null]) {
      expect(sanitizeSettings({ theme }).theme).toBe(DEFAULT_SETTINGS.theme)
    }
  })

  it('falls back for bad timestamp settings', () => {
    expect(sanitizeSettings({ timestamps: '48h' }).timestamps).toBe('off')
    expect(sanitizeSettings({ timestampSeconds: 'yes' }).timestampSeconds).toBe(false)
  })

  it('turns go-live alerts on by default and only honours real booleans', () => {
    expect(DEFAULT_SETTINGS.liveAlerts).toBe(true)
    expect(sanitizeSettings({}).liveAlerts).toBe(true)
    expect(sanitizeSettings({ liveAlerts: false }).liveAlerts).toBe(false)
    expect(sanitizeSettings({ liveAlerts: 'no' }).liveAlerts).toBe(true)
    expect(sanitizeSettings({ liveAlerts: 0 }).liveAlerts).toBe(true)
  })

  describe('blacklist', () => {
    it('trims, collapses spaces and removes duplicates ignoring case', () => {
      expect(sanitizeSettings({ blacklist: ['  free   followers ', 'FREE FOLLOWERS', 'spam'] }).blacklist).toEqual(['free followers', 'spam'])
    })

    it('drops non-strings, empty and over-long terms', () => {
      const long = 'x'.repeat(MAX_TERM_LENGTH + 1)
      expect(sanitizeSettings({ blacklist: [1, null, {}, '', '   ', long, 'ok'] }).blacklist).toEqual(['ok'])
      expect(sanitizeSettings({ blacklist: ['x'.repeat(MAX_TERM_LENGTH)] }).blacklist).toHaveLength(1)
    })

    it('caps the list size', () => {
      const many = Array.from({ length: MAX_BLACKLIST_TERMS + 50 }, (_, i) => `term${i}`)
      expect(sanitizeSettings({ blacklist: many }).blacklist).toHaveLength(MAX_BLACKLIST_TERMS)
    })

    it('ignores a blacklist that is not an array', () => {
      expect(sanitizeSettings({ blacklist: 'spam' }).blacklist).toEqual([])
    })
  })
})

describe('normalizeTerm', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTerm('  a \t b\n c  ')).toBe('a b c')
    expect(normalizeTerm('   ')).toBe('')
  })
})

describe('pickSettings', () => {
  it('returns only the saved fields', () => {
    const picked = pickSettings({ ...DEFAULT_SETTINGS, extra: 1 } as never)
    expect(Object.keys(picked).sort()).toEqual(['blacklist', 'liveAlerts', 'theme', 'timestampSeconds', 'timestamps'])
  })
})
