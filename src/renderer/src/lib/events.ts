/**
 * renderer/src/lib/events.ts
 *
 * WHAT: Labels and colours for event rows, plus the text shown for removed messages.
 *
 * To restyle an event (e.g. make raids orange), change its `color`. To handle a brand-new event type,
 * add it to `EventType` (shared/types.ts), map Twitch's id to it (main/adapters/twitch/parse.ts),
 * and give it an entry here.
 */
import type { EventType, RemovedReason } from '../../../shared/types'

export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  sub: { label: 'Sub', color: '#ffd166' },
  resub: { label: 'Resub', color: '#ffd166' },
  subgift: { label: 'Gift', color: '#ff7ab6' },
  giftbomb: { label: 'Gift bomb', color: '#ff7ab6' },
  raid: { label: 'Raid', color: '#5eead4' },
  announcement: { label: 'Announcement', color: '#9b6bff' },
  milestone: { label: 'Milestone', color: '#a3e635' },
  member: { label: 'Member', color: '#4ade80' },
  poll: { label: 'Poll', color: '#38bdf8' },
  prediction: { label: 'Prediction', color: '#f472b6' },
  redemption: { label: 'Reward', color: '#2dd4bf' },
  moderation: { label: 'Mod', color: '#8d86a3' },
  notice: { label: 'Notice', color: '#8d86a3' }
}

/** What a removed message shows in place of its text until clicked. */
export const REMOVED_TEXT: Record<RemovedReason, string> = {
  deleted: 'Message deleted',
  timeout: 'Removed by timeout',
  ban: 'Removed by ban'
}
