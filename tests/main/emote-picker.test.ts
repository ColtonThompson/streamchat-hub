/** tests/main/emote-picker.test.ts: the emote picker's sections, Helix parsing and the download cache. */
import { describe, expect, it } from 'vitest'
import { buildGroups, nativeEmoteUrl, parseHelixEmotes, TtlCache } from '../../src/main/emotes/picker'
import { EmoteService } from '../../src/main/emotes/service'
import type { Emote } from '../../src/main/emotes/types'

const h = (id: string, name: string, owner_id?: string) => ({ id, name, owner_id })
const x = (name: string, source: Emote['source'] = '7tv'): Emote => ({ name, url: `https://cdn/${name}`, source })
const base = { channelLogin: 'chan', broadcasterId: '10', nativeGlobal: [], nativeChannel: [], thirdChannel: [], thirdGlobal: [] }

describe('parseHelixEmotes', () => {
  it('keeps well-formed entries and ignores junk', () => {
    expect(parseHelixEmotes({ data: [{ id: '1', name: 'Kappa', emote_type: 'globals', owner_id: '0' }, { id: 2 }, null, { id: '3', name: '' }] })).toEqual([{ id: '1', name: 'Kappa', emote_type: 'globals', owner_id: '0' }])
    expect(parseHelixEmotes(null)).toEqual([])
    expect(parseHelixEmotes({ data: 'x' })).toEqual([])
  })
})

describe('buildGroups', () => {
  it('without "your emotes": channel + global from Twitch, then third-party, sorted, empty sections dropped', () => {
    const g = buildGroups({ ...base, nativeChannel: [h('2', 'chanB'), h('1', 'chanA')], nativeGlobal: [h('9', 'Kappa')], thirdChannel: [x('catJAM')], thirdGlobal: [] })
    expect(g.map((s) => s.id)).toEqual(['channel', 'twitch', 'ext-channel'])
    expect(g[0].emotes.map((e) => e.name)).toEqual(['chanA', 'chanB'])
    expect(g[0].note).toBeTruthy()
    expect(g[1].emotes[0].url).toBe(nativeEmoteUrl('9'))
  })
  it('with "your emotes": split by owner and no subscription warning', () => {
    const g = buildGroups({ ...base, userEmotes: [h('1', 'mine', '10'), h('2', 'Kappa', '0'), h('3', 'otherSub', '77')] })
    expect(g.map((s) => `${s.id}:${s.emotes.map((e) => e.name).join(',')}`)).toEqual(['channel:mine', 'twitch:Kappa', 'other:otherSub'])
    expect(g[0].note).toBeUndefined()
  })
  it('treats an empty owner like Twitch\'s own (global) emotes', () => {
    const g = buildGroups({ ...base, userEmotes: [h('2', 'Kappa', ''), h('4', 'Plain')] })
    expect(g.map((s) => s.id)).toEqual(['twitch'])
    expect(g[0].emotes).toHaveLength(2)
  })
  it('drops duplicate names within a section', () => {
    const g = buildGroups({ ...base, thirdGlobal: [x('A'), x('A', 'bttv')] })
    expect(g[0].emotes).toHaveLength(1)
  })
})

describe('EmoteService.list', () => {
  it('returns channel and global third-party emotes', async () => {
    const s = new EmoteService([{ name: '7tv', global: async () => [x('G')], channel: async () => [x('C')] }])
    s.registerChannel('twitch', 'chan', '10')
    await s.ready('twitch', 'chan')
    expect(s.list('twitch', 'chan')).toEqual({ channel: [x('C')], global: [x('G')] })
    expect(s.list('twitch', 'unknown').channel).toEqual([])
    s.dispose()
  })
})

describe('TtlCache', () => {
  it('loads once within the ttl, again after, and does not remember failures', async () => {
    let t = 0
    let calls = 0
    const c = new TtlCache<number>(1000, () => t)
    const load = async () => ++calls
    expect(await c.get('k', load)).toBe(1)
    t = 500
    expect(await c.get('k', load)).toBe(1)
    t = 1500
    expect(await c.get('k', load)).toBe(2)
    await expect(c.get('bad', async () => Promise.reject(new Error('x')))).rejects.toThrow()
    expect(await c.get('bad', load)).toBe(3)
  })
})
