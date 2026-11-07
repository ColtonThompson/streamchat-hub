/**
 * renderer/src/lib/rows.ts
 *
 * WHAT: Decides which messages the feed shows and which background shade each row gets.
 *       (It used to be inline in ChatFeed.tsx; it's a plain function so it can be tested.)
 *
 * FILTERS APPLIED, in one pass over the messages:
 *   - platform switched off      -> hidden
 *   - event row, events turned off -> hidden
 *   - chat line matching the blacklist -> hidden
 * Nothing is deleted; a hidden message is simply not in the returned list.
 *
 * SHADING: rows alternate between two background shades. The naive way (shade by position) would
 *   make EVERY row flip colour each time the oldest message is trimmed away. So each message
 *   remembers the shade it was first given (`ShadingMemory.map`), and only NEW messages take the
 *   opposite shade of the one before them. The memory is thrown away and rebuilt only when what is
 *   visible changes (platform set, events toggle, blacklist), which is the one time a re-shade is expected.
 */
import { PLATFORMS, type ChatMessage, type Platform } from '../../../shared/types'

/** A message paired with its background shade (0 or 1). */
export interface Row {
  msg: ChatMessage
  alt: 0 | 1
}

/** What `buildRows` remembers between calls. Keep one per feed (a React ref in ChatFeed). */
export interface ShadingMemory {
  /** Describes which platforms/events were visible when the shades were assigned. */
  key: string
  /** The blacklist array the shades were assigned under (compared by reference). */
  blacklist: string[]
  /** message id -> shade */
  map: Map<string, 0 | 1>
}

export const newShading = (blacklist: string[]): ShadingMemory => ({ key: '', blacklist, map: new Map() })

export interface FeedFilters {
  enabled: Record<Platform, boolean>
  showEvents: boolean
  /** The raw list; only used to notice that it changed (compared by reference). */
  blacklist: string[]
  /** Built from `blacklist` by compileBlacklist (lib/blacklist.ts). */
  isBlacklisted: (msg: ChatMessage) => boolean
}

/** Filter and shade. `memory` is a `{ current }` box (a React ref) that this function updates. */
export function buildRows(messages: ChatMessage[], filters: FeedFilters, memory: { current: ShadingMemory }): Row[] {
  const key = PLATFORMS.filter((p) => filters.enabled[p]).join() + (filters.showEvents ? '+events' : '')
  // `blacklist` is compared by reference: the settings store creates a new array whenever it changes.
  if (memory.current.key !== key || memory.current.blacklist !== filters.blacklist) {
    memory.current = { key, blacklist: filters.blacklist, map: new Map() }
  }
  const { map } = memory.current

  const out: Row[] = []
  let prev: 0 | 1 = 1
  for (const msg of messages) {
    if (!filters.enabled[msg.platform] || (msg.event && !filters.showEvents) || filters.isBlacklisted(msg)) continue
    let alt = map.get(msg.id)
    if (alt === undefined) {
      alt = prev === 0 ? 1 : 0 // a new message takes the opposite shade of the one before it
      map.set(msg.id, alt)
    }
    prev = alt
    out.push({ msg, alt })
  }
  // Forget shades of messages that were trimmed away, so the map can't grow forever.
  if (map.size > out.length * 2 + 200) {
    memory.current.map = new Map(out.map((r) => [r.msg.id, r.alt]))
  }
  return out
}
