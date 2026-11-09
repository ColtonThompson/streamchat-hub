/**
 * tests/shared/zoom.test.ts: the chat text-size rules and the keyboard shortcuts that drive them.
 */
import { describe, expect, it } from 'vitest'
import { applyZoomAction, clampZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, zoomActionForKey } from '../../src/shared/zoom'

describe('clampZoom', () => {
  it('keeps valid sizes, rounds, and clamps to the limits', () => {
    expect(clampZoom(100)).toBe(100)
    expect(clampZoom(133.6)).toBe(134)
    expect(clampZoom(10)).toBe(ZOOM_MIN)
    expect(clampZoom(5000)).toBe(ZOOM_MAX)
  })
  it('falls back to 100 for anything that is not a usable number', () => {
    for (const bad of [NaN, Infinity, -Infinity, '120', null, undefined, {}]) expect(clampZoom(bad)).toBe(ZOOM_DEFAULT)
  })
})

describe('applyZoomAction', () => {
  it('steps by 10, resets to 100, and stops at the limits', () => {
    expect(applyZoomAction(100, 'in')).toBe(110)
    expect(applyZoomAction(100, 'out')).toBe(90)
    expect(applyZoomAction(180, 'reset')).toBe(100)
    expect(applyZoomAction(ZOOM_MAX, 'in')).toBe(ZOOM_MAX)
    expect(applyZoomAction(ZOOM_MIN, 'out')).toBe(ZOOM_MIN)
  })
  it('repairs a bad current value before stepping', () => {
    expect(applyZoomAction(NaN, 'in')).toBe(110)
  })
})

describe('zoomActionForKey', () => {
  const k = (key: string, extra = {}) => zoomActionForKey({ key, control: true, type: 'keyDown', ...extra })
  it('maps Ctrl + / = / - / 0', () => {
    expect(k('+')).toBe('in')
    expect(k('=')).toBe('in')
    expect(k('-')).toBe('out')
    expect(k('_')).toBe('out')
    expect(k('0')).toBe('reset')
  })
  it('accepts Cmd (meta) as well as Ctrl', () => {
    expect(zoomActionForKey({ key: '=', meta: true })).toBe('in')
  })
  it('ignores plain keys, other combos, Alt and key-up events', () => {
    expect(zoomActionForKey({ key: '=' })).toBeUndefined()
    expect(zoomActionForKey({ key: 'a', control: true })).toBeUndefined()
    expect(k('=', { alt: true })).toBeUndefined()
    expect(k('=', { type: 'keyUp' })).toBeUndefined()
  })
})
