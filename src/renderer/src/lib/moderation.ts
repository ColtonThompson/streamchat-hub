/**
 * renderer/src/lib/moderation.ts
 *
 * WHAT: Applies a ModerationEvent (a message was deleted / a user was timed out or banned) to the list
 *       of messages already on screen, by marking the affected ones as `removed`.
 *
 * It is a PURE function (no side effects, same input -> same output), which makes it easy to test.
 * The store calls it from `addItems`.
 *
 * Messages are never deleted from memory: they are marked, and MessageRow shows the "Message deleted"
 * placeholder (click to peek). That is deliberate: it lets you see what a moderator removed.
 */
import type { ChatMessage, ModerationEvent } from '../../../shared/types'

/**
 * Returns the messages with the affected ones marked as removed.
 * Returns the SAME array object when nothing matched, so React can skip re-rendering.
 */
export function applyModeration(messages: ChatMessage[], action: ModerationEvent): ChatMessage[] {
  let changed = false
  const next = messages.map((m) => {
    // Only messages in the same channel, and not already removed, can be affected.
    if (m.platform !== action.platform || m.channelId !== action.channelId || m.removed) return m

    const hit =
      action.type === 'delete-message'
        ? m.id === action.messageId
        : action.userId
          ? m.author.id === action.userId // match by id when we have it: names can be changed or imitated
          : m.author.name.toLowerCase() === action.login

    if (!hit) return m
    changed = true
    const removed = action.type === 'delete-message' ? 'deleted' : action.durationSec ? 'timeout' : 'ban'
    return { ...m, removed } as ChatMessage // a COPY: React sees a new object and re-renders just that row
  })
  return changed ? next : messages
}
