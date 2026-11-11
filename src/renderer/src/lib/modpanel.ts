/**
 * renderer/src/lib/modpanel.ts   (the user panel's rules; no React, easy to test)
 *
 * WHAT: Click a chat message (as a moderator) and a panel opens with that person's messages from this session and
 * the moderation buttons. This file decides
 *   - which rows can open it, and for whom        `modTargetFor`
 *   - which messages belong in the history        `userHistory`
 *   - what the person's current state looks like  `userStatus`
 *   - what a hotkey press means                   `modKeyAction`
 */
import type { AuthState, ChatMessage, Platform } from '../../../shared/types'

/** Who the panel is about. `channelId` is where any action happens (moderation is per channel). */
export interface ModTarget {
  platform: Platform
  channelId: string
  userId: string
  name: string
  /** Opened from a "was banned / timed out" note, so an unban is offered even if no message of theirs is on screen. */
  fromNote?: boolean
  /** You or the channel owner: history only, no ban / timeout / unban (you can't moderate yourself or the owner). */
  readOnly?: boolean
}

/**
 * The person a click on this row should open the panel for, or undefined when the row is not clickable that way.
* Twitch only, and only with moderation tools on. Rows that qualify: any normal chat line (yours and the channel
 * owner's open a read-only panel), and a "was banned / timed out" note (so a ban can be undone). Removed rows keep their own click
 * (peek at the removed message).
 */
export function modTargetFor(msg: ChatMessage, auth: Pick<AuthState, 'canModerate' | 'userId'>): ModTarget | undefined {
  if (!auth.canModerate || msg.platform !== 'twitch') return undefined
  const note = msg.event?.type === 'moderation' ? msg.event.target : undefined
  if (note?.userId) return { platform: msg.platform, channelId: msg.channelId, userId: note.userId, name: note.login, fromNote: true }
  if (msg.event || msg.removed || !msg.author.id) return undefined
  // Yourself and the channel owner can't be banned, so those rows open a history-only panel.
  const readOnly = msg.author.id === auth.userId || msg.author.badges.some((b) => b.id.startsWith('broadcaster/'))
  return { platform: msg.platform, channelId: msg.channelId, userId: msg.author.id, name: msg.author.name, ...(readOnly ? { readOnly: true } : {}) }
}

/** That person's chat lines in this channel from this session, oldest first (removed ones included, marked). */
export function userHistory(messages: ChatMessage[], target: ModTarget): ChatMessage[] {
  return messages.filter((m) => m.platform === target.platform && m.channelId === target.channelId && !m.event && m.author.id === target.userId)
}

export type UserStatus = 'banned' | 'timeout' | undefined

/** Whether the latest removed line says they were banned or timed out (a timeout may have ended since). */
export function userStatus(history: ChatMessage[]): UserStatus {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i].removed
    if (r === 'ban' || r === 'timeout') return r === 'ban' ? 'banned' : 'timeout'
  }
  return undefined
}

export type ModKeyAction = 'ban' | 'timeout' | 'unban' | 'close'

/** What a key press means in the panel: B ban, T timeout, U unban, Esc close. Anything with Ctrl/Cmd/Alt is not ours. */
export function modKeyAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ModKeyAction | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined
  switch (e.key.toLowerCase()) {
    case 'b':
      return 'ban'
    case 't':
      return 'timeout'
    case 'u':
      return 'unban'
    case 'escape':
      return 'close'
    default:
      return undefined
  }
}
