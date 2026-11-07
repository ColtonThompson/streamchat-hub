/**
 * main/adapters/mock.ts
 *
 * WHAT: A fake platform that produces random chat, occasional events (subs, raids, announcements)
 *       and occasional message deletions. Used for every platform that has no real adapter yet.
 *
 * WHY: Lets you design and test the UI (spacing, colours, event cards, removed-message styling)
 *       without being connected to anything or waiting for a real subscription to happen.
 *
 * HOW IT FITS: It implements the same `ChatAdapter` contract as the real adapters, so the rest of the
 *       app can't tell the difference. Delete or ignore it once every platform is real.
 */
import type { ChatMessage, MessagePart, Platform } from '../../shared/types'
import type { AdapterEmit, ChatAdapter } from './base'

/** Draws a small coloured square with a letter, as an inline image (no files or network needed). */
const emoteSvg = (label: string, bg: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="7" fill="${bg}"/><text x="14" y="19" font-size="13" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${label}</text></svg>`
  )

/** Placeholder emotes, keyed by the word that triggers them. */
const EMOTES: Record<string, { url: string; source: 'native' | '7tv' | 'bttv' | 'ffz' }> = {
  Kappa: { url: emoteSvg('K', '#6b5bd6'), source: 'native' },
  PogChamp: { url: emoteSvg('P', '#d9822b'), source: 'native' },
  LUL: { url: emoteSvg('L', '#2b9d8f'), source: 'bttv' },
  catJAM: { url: emoteSvg('J', '#c64d8a'), source: '7tv' },
  OMEGALUL: { url: emoteSvg('O', '#4f8fe0'), source: 'ffz' }
}

const NAMES = ['pixelwitch', 'DrowsyOtter', 'xX_ghost_Xx', 'marimo', 'tofuking', 'nightbus', 'ElbowGrease', 'vexx', 'lunaticfringe', 'Sparrowhawk']
const COLORS = ['#ff7a90', '#7dd3fc', '#a3e635', '#f9a8d4', '#fbbf24', '#c4b5fd', '#5eead4', '#fb923c']
const LINES = [
  'that was insane Kappa',
  'chat is moving so fast right now',
  'first time here, loving the setup',
  'LUL no way he missed that',
  'can you show the settings menu again?',
  'catJAM catJAM catJAM',
  'gg, see you tomorrow',
  'PogChamp clutch',
  'this song is so good',
  'OMEGALUL the timing',
  'what keyboard is that?',
  'hello from Brazil 👋'
]

/** Pick a random item from a list. */
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/** Split a sentence into text and emote parts (same output shape as the real adapters). */
function tokenize(line: string): MessagePart[] {
  return line.split(' ').flatMap((word, i, all): MessagePart[] => {
    const e = EMOTES[word]
    const part: MessagePart = e ? { type: 'emote', value: word, url: e.url, source: e.source } : { type: 'text', value: word }
    return i < all.length - 1 ? [part, { type: 'text', value: ' ' }] : [part]
  })
}

export class MockAdapter implements ChatAdapter {
  private timer?: NodeJS.Timeout
  /** Counts messages made so far; also drives "every Nth message, do something special". */
  private n = 0
  /** Ids of the last ~30 messages, so we can pretend a moderator deleted one of them. */
  private recent: string[] = []

  constructor(
    readonly platform: Platform,
    private emit: AdapterEmit
  ) {}

  async connect(): Promise<void> {
    this.emit.status({ state: 'connecting' })
    await new Promise((r) => setTimeout(r, 600)) // pretend it takes a moment, so the "connecting" dot is visible
    this.emit.status({ state: 'connected', detail: 'mock feed' })

    // Emit one message, then schedule the next at a random 0.3-1.7 s interval (more natural than a fixed beat).
    const tick = () => {
      const m = this.fake()
      this.emit.message(m)
      this.recent = [...this.recent.slice(-30), m.id]
      if (this.n % 17 === 0 && this.recent.length > 5) {
        this.emit.moderation?.({ type: 'delete-message', platform: this.platform, channelId: 'mock', messageId: pick(this.recent) })
      }
      if (this.n % 23 === 0) this.emit.message(this.fakeEvent())
      this.timer = setTimeout(tick, 300 + Math.random() * 1400)
    }
    tick()
  }

  disconnect(): void {
    clearTimeout(this.timer)
    this.emit.status({ state: 'disconnected' })
  }

  /** A fake sub / resub / raid / announcement row. */
  private fakeEvent(): ChatMessage {
    const base = this.fake()
    const name = base.author.name
    const events = [
      { type: 'sub' as const, title: `${name} subscribed with Prime.`, parts: [] },
      { type: 'resub' as const, title: `${name} subscribed at Tier 1. They've subscribed for 8 months!`, parts: tokenize('still here after all this time catJAM') },
      { type: 'raid' as const, title: `12 raiders from ${name} have joined!`, parts: [] },
      { type: 'announcement' as const, title: '', parts: tokenize('Giveaway starts in five minutes!') }
    ]
    const { parts, ...event } = pick(events)
    return { ...base, id: base.id + '-evt', parts, event }
  }

  /** A fake chat line from a random viewer. */
  private fake(): ChatMessage {
    const roll = Math.random() // one roll decides badge and rare extras, so they stay consistent
    return {
      id: `${this.platform}-${Date.now()}-${this.n++}`,
      platform: this.platform,
      channelId: 'mock',
      author: {
        name: pick(NAMES),
        color: pick(COLORS),
        badges: roll > 0.85 ? [{ id: 'mod', label: 'MOD' }] : roll > 0.65 ? [{ id: 'sub', label: 'SUB' }] : []
      },
      parts: tokenize(pick(LINES)),
      timestamp: Date.now(),
      meta: {
        isMod: roll > 0.85,
        isSub: roll > 0.65 && roll <= 0.85,
        superChat: this.platform === 'youtube' && roll < 0.03 ? { label: '$5.00' } : undefined
      }
    }
  }
}
