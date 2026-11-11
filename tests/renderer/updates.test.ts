/** tests/renderer/updates.test.ts: when the UI announces an app update. */
import { describe, expect, it } from 'vitest'
import { bannerText, updatePending } from '../../src/renderer/src/lib/updates'
import type { UpdateState } from '../../src/shared/types'

const v = '1.0.0'
describe('updatePending', () => {
  it('is true from found until installed, false otherwise', () => {
    expect(updatePending({ status: 'available', version: v, next: '1.1.0' })).toBe(true)
    expect(updatePending({ status: 'downloading', version: v, next: '1.1.0', percent: 5 })).toBe(true)
    expect(updatePending({ status: 'ready', version: v, next: '1.1.0' })).toBe(true)
    for (const s of [undefined, { status: 'idle', version: v }, { status: 'checking', version: v }, { status: 'none', version: v, checkedAt: 1 }, { status: 'error', version: v, message: 'x' }, { status: 'disabled', version: v }] as (UpdateState | undefined)[]) {
      expect(updatePending(s)).toBe(false)
    }
  })
})
describe('bannerText', () => {
  it('describes the download and stays quiet otherwise', () => {
    expect(bannerText({ status: 'available', version: v, next: '1.1.0' })).toContain('1.1.0')
    expect(bannerText({ status: 'downloading', version: v, next: '1.1.0', percent: 41.6 })).toBe('Downloading version 1.1.0… 42%')
    expect(bannerText({ status: 'ready', version: v, next: '1.1.0' })).toBeUndefined()
    expect(bannerText(undefined)).toBeUndefined()
  })
})
