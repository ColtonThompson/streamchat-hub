/**
 * tests/renderer/permissions.test.ts: which Twitch permissions are missing, and when the banner speaks up.
 */
import { describe, expect, it } from 'vitest'
import { loginOptionsFor, missingPermissions, permissionNotice, permissionStatus } from '../../src/renderer/src/lib/permissions'
import type { AuthState, Platform } from '../../src/shared/types'

const signedIn = (over: Partial<AuthState> = {}): AuthState => ({ status: 'signed-in', configured: true, login: 'Nightleaf', ...over })
const on = (twitch: boolean) => ({ twitch, youtube: false, kick: false, x: false, tiktok: false }) as Record<Platform, boolean>

describe('permissionStatus / missingPermissions', () => {
  it('lists every permission with its state', () => {
    const s = permissionStatus(signedIn({ canModerate: true, canReadFollows: true }))
    expect(s.map((x) => `${x.info.id}:${x.granted}`)).toEqual(['moderation:true', 'polls:false', 'redemptions:false', 'follows:true'])
  })
  it('missing = the ones not granted, in order', () => {
    expect(missingPermissions(signedIn({ canReadPolls: true })).map((p) => p.id)).toEqual(['moderation', 'redemptions', 'follows'])
    expect(missingPermissions(signedIn({ canModerate: true, canReadPolls: true, canReadRedemptions: true, canReadFollows: true }))).toEqual([])
  })
  it('nothing is "missing" while signed out (you must sign in first)', () => {
    expect(missingPermissions({ status: 'signed-out', configured: true })).toEqual([])
  })
})

describe('loginOptionsFor', () => {
  it('builds the sign-in options for exactly those groups', () => {
    expect(loginOptionsFor(['polls', 'redemptions'])).toEqual({ polls: true, redemptions: true })
    expect(loginOptionsFor([])).toEqual({})
  })
})

describe('permissionNotice', () => {
  it('speaks up when you read your own channel without polls/redemptions', () => {
    const n = permissionNotice(signedIn(), on(true), 'someone, nightleaf')!
    expect(n.ids).toEqual(['polls', 'redemptions'])
    expect(n.text).toContain('polls and predictions and reward redemptions')
    expect(n.key).toBe('own-channel:polls+redemptions')
  })
  it('names only what is missing, and the key changes with it', () => {
    const n = permissionNotice(signedIn({ canReadPolls: true }), on(true), '#NIGHTLEAF')!
    expect(n.ids).toEqual(['redemptions'])
    expect(n.text).toContain('reward redemptions')
    expect(n.text).not.toContain('polls')
    expect(n.key).toBe('own-channel:redemptions')
  })
  it('is quiet when everything needed is granted', () => {
    expect(permissionNotice(signedIn({ canReadPolls: true, canReadRedemptions: true }), on(true), 'nightleaf')).toBeNull()
  })
  it('is quiet when you are not reading your own channel, Twitch is off, or you are signed out', () => {
    expect(permissionNotice(signedIn(), on(true), 'someone_else')).toBeNull()
    expect(permissionNotice(signedIn(), on(false), 'nightleaf')).toBeNull()
    expect(permissionNotice({ status: 'signed-out', configured: true }, on(true), 'nightleaf')).toBeNull()
  })
  it('does not match part of another name', () => {
    expect(permissionNotice(signedIn(), on(true), 'nightleaf2, xnightleaf')).toBeNull()
  })
})
