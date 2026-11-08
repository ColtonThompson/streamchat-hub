/**
 * tests/main/emotes.test.ts
 *
 * Third-party emotes (7TV / BTTV / FFZ): swapping emote words for emote images in a message, zero-width
 * overlays, name priority, and surviving a provider that is down. Uses fake providers: no network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EmoteService } from '../../src/main/emotes/service'
import type { Emote, EmoteProvider } from '../../src/main/emotes/types'
import { chatMessage } from '../helpers/factories'

const emote = (name: string, source: Emote['source'] = '7tv', zeroWidth = false): Emote => ({ name, url: `https://cdn/${source}/${name}.png`, source, zeroWidth })

function provider(name: Emote['source'], global: Emote[] = [], channel: Emote[] | (() => Promise<Emote[]>) = []): EmoteProvider & { channelCalls: string[] } {
  const channelCalls: string[] = []
  return {
    name,
    channelCalls,
    global: async () => global,
    channel: async (id) => {
      channelCalls.push(id)
      return typeof channel === 'function' ? channel() : channel
    }
  }
}

const quiet: { log: typeof console.log; warn: typeof console.warn; warnings: unknown[][] } = { log: console.log, warn: console.warn, warnings: [] }
let services: EmoteService[] = []
const make = (providers: EmoteProvider[]) => {
  const s = new EmoteService(providers)
  services.push(s)
  return s
}
const words = (m: { parts: { type: string; value: string }[] }) => m.parts.map((p) => (p.type === 'emote' ? `<${p.value}>` : p.value)).join('')

beforeEach(() => {
  quiet.warnings = []
  console.log = () => {}
  console.warn = (...a: unknown[]) => void quiet.warnings.push(a)
})
afterEach(() => {
  console.log = quiet.log
  console.warn = quiet.warn
  services.forEach((s) => s.dispose())
  services = []
})

describe('EmoteService.process', () => {
  it('replaces global emote words and keeps the spacing exactly', async () => {
    const s = make([provider('7tv', [emote('catJAM')])])
    await s.ready('twitch', 'chan')
    expect(words(s.process(chatMessage({ text: 'hey  catJAM  catJAM!' })))).toBe('hey  <catJAM>  catJAM!') // "catJAM!" is a different word
  })

  it('gives the emote part its image and source', async () => {
    const s = make([provider('bttv', [emote('OMEGALUL', 'bttv')])])
    await s.ready('twitch', 'chan')
    const part = s.process(chatMessage({ text: 'OMEGALUL' })).parts[0]
    expect(part).toEqual({ type: 'emote', value: 'OMEGALUL', url: 'https://cdn/bttv/OMEGALUL.png', source: 'bttv' })
  })

  it('uses a channel\'s own emotes, which win over a global emote of the same name', async () => {
    const s = make([provider('7tv', [emote('Wave', '7tv')], [emote('Wave', 'bttv'), emote('ChanOnly')])])
    s.registerChannel('twitch', 'chan', '42')
    await s.ready('twitch', 'chan')
    const out = s.process(chatMessage({ text: 'Wave ChanOnly' }))
    expect(out.parts[0]).toMatchObject({ source: 'bttv' })
    expect(words(out)).toBe('<Wave> <ChanOnly>')
    expect(words(s.process(chatMessage({ channelId: 'other', text: 'ChanOnly' })))).toBe('ChanOnly') // another channel does not get them
  })

  it('lets the first provider win a name clash', async () => {
    const s = make([provider('7tv', [emote('Dup', '7tv')]), provider('bttv', [emote('Dup', 'bttv')])])
    await s.ready('twitch', 'chan')
    expect(s.process(chatMessage({ text: 'Dup' })).parts[0]).toMatchObject({ source: '7tv' })
  })

  it('leaves other platforms, links and native emotes alone', async () => {
    const s = make([provider('7tv', [emote('catJAM')])])
    await s.ready('twitch', 'chan')
    const yt = chatMessage({ platform: 'youtube', text: 'catJAM' })
    expect(s.process(yt)).toBe(yt)
    const mixed = chatMessage({
      parts: [
        { type: 'emote', value: 'catJAM', url: 'native', source: 'native' },
        { type: 'link', value: 'catJAM', url: 'https://x' }
      ]
    })
    expect(s.process(mixed).parts).toEqual(mixed.parts)
  })

  it('never modifies the original message', async () => {
    const s = make([provider('7tv', [emote('catJAM')])])
    await s.ready('twitch', 'chan')
    const m = chatMessage({ text: 'catJAM' })
    const out = s.process(m)
    expect(out).not.toBe(m)
    expect(m.parts).toEqual([{ type: 'text', value: 'catJAM' }])
  })

  it('merges neighbouring plain text into one part', async () => {
    const s = make([provider('7tv', [emote('catJAM')])])
    await s.ready('twitch', 'chan')
    expect(s.process(chatMessage({ text: 'a b c' })).parts).toEqual([{ type: 'text', value: 'a b c' }])
  })
})

describe('zero-width emotes', () => {
  const setup = async () => {
    const s = make([provider('7tv', [emote('catJAM'), emote('RainbowHat', '7tv', true)])])
    await s.ready('twitch', 'chan')
    return s
  }

  it('stack on the emote before them (spaces in between are dropped)', async () => {
    const out = (await setup()).process(chatMessage({ text: 'catJAM  RainbowHat' }))
    expect(out.parts).toHaveLength(1)
    expect(out.parts[0]).toMatchObject({ type: 'emote', value: 'catJAM', overlays: [{ value: 'RainbowHat', url: 'https://cdn/7tv/RainbowHat.png' }] })
  })

  it('can stack several', async () => {
    const out = (await setup()).process(chatMessage({ text: 'catJAM RainbowHat RainbowHat' }))
    expect((out.parts[0] as { overlays: unknown[] }).overlays).toHaveLength(2)
  })

  it('show as a normal emote when there is nothing to stack on', async () => {
    const out = (await setup()).process(chatMessage({ text: 'hello RainbowHat' }))
    expect(words(out)).toBe('hello <RainbowHat>')
    expect((out.parts[1] as { overlays?: unknown }).overlays).toBeUndefined()
  })
})

describe('loading', () => {
  it('survives a provider that fails, and says so', async () => {
    const broken: EmoteProvider = { name: 'ffz', global: async () => Promise.reject(new Error('503')), channel: async () => [] }
    const s = make([broken, provider('7tv', [emote('catJAM')])])
    await s.ready('twitch', 'chan')
    expect(words(s.process(chatMessage({ text: 'catJAM' })))).toBe('<catJAM>')
    expect(String(quiet.warnings[0])).toContain('ffz')
  })

  it('looks a channel up once, however often it is registered', async () => {
    const p = provider('7tv', [], [emote('X')])
    const s = make([p])
    s.registerChannel('twitch', 'chan', '42')
    s.registerChannel('twitch', 'chan', '42')
    await s.ready('twitch', 'chan')
    expect(p.channelCalls).toEqual(['42'])
  })

  it('does not stall chat when a provider never answers (ready() gives up after a few seconds)', async () => {
    const never: EmoteProvider = { name: '7tv', global: () => new Promise(() => {}), channel: async () => [] }
    const s = make([never])
    const started = Date.now()
    await s.ready('twitch', 'chan')
    expect(Date.now() - started).toBeLessThan(5000)
    expect(words(s.process(chatMessage({ text: 'plain words' })))).toBe('plain words') // still processes, just without emotes
  })
})
