/**
 * tests/renderer/color.test.ts
 *
 * Colour maths that keeps names readable on every theme (people choose their own chat colours, and some
 * are nearly invisible on a dark or a light background).
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex, readableOn, textOn } from '../../src/renderer/src/lib/color'

const ratio = (a: string, b: string) => contrastRatio(parseHex(a)!, parseHex(b)!)

describe('parseHex', () => {
  it('reads 6 and 3 digit colours, with or without #, any case', () => {
    expect(parseHex('#ff8000')).toEqual([255, 128, 0])
    expect(parseHex('FF8000')).toEqual([255, 128, 0])
    expect(parseHex('#f80')).toEqual([255, 136, 0])
    expect(parseHex('  #000 ')).toEqual([0, 0, 0])
  })

  it('returns null for anything else', () => {
    for (const bad of ['', '#12', '#12345', '#gggggg', 'red', '#1234567', '#00000088']) expect(parseHex(bad)).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours, in either order', () => {
    expect(ratio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(ratio('#fff', '#000')).toBeCloseTo(21, 5)
    expect(ratio('#7a7a7a', '#7a7a7a')).toBeCloseTo(1, 5)
  })
})

describe('textOn', () => {
  it('picks dark text on light backgrounds and white text on dark ones', () => {
    expect(textOn('#ffd166')).toBe('#14111b') // yellow
    expect(textOn('#ffffff')).toBe('#14111b')
    expect(textOn('#1a237e')).toBe('#ffffff') // navy
    expect(textOn('#000000')).toBe('#ffffff')
  })

  it('uses dark text when there is no usable colour', () => {
    expect(textOn(undefined)).toBe('#14111b')
    expect(textOn('not-a-colour')).toBe('#14111b')
  })
})

describe('readableOn', () => {
  const darkBg = '#15121d'
  const lightBg = '#fafafa'

  it('returns undefined when there is no colour', () => {
    expect(readableOn(undefined, darkBg)).toBeUndefined()
  })

  it('leaves colours that are already readable untouched', () => {
    expect(readableOn('#ffffff', darkBg)).toBe('#ffffff')
    expect(readableOn('#101010', lightBg)).toBe('#101010')
  })

  it('lightens a too-dark colour on a dark background until it is readable', () => {
    const out = readableOn('#1a1a40', darkBg)!
    expect(out).not.toBe('#1a1a40')
    expect(ratio(out, darkBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('darkens a too-pale colour on a light background until it is readable', () => {
    const out = readableOn('#ffff99', lightBg)!
    expect(ratio(out, lightBg)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the hue of the original colour roughly the same', () => {
    const [r, g, b] = parseHex(readableOn('#2a0a0a', darkBg)!)! // very dark red
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('honours a different minimum ratio', () => {
    const out = readableOn('#555555', darkBg, 7)!
    expect(ratio(out, darkBg)).toBeGreaterThanOrEqual(7)
  })

  it('passes through values it cannot parse', () => {
    expect(readableOn('rebeccapurple', darkBg)).toBe('rebeccapurple')
  })
})
