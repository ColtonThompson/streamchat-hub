/**
 * tests/helpers/factories.ts   (small builders so each test states only what it cares about)
 */
import type { ChatMessage } from '../../src/shared/types'

let counter = 0

/** A plain Twitch chat message with sensible defaults; pass `over` to change any field. */
export function chatMessage(over: Partial<ChatMessage> & { text?: string; name?: string } = {}): ChatMessage {
  const { text, name, ...rest } = over
  return {
    id: `m${++counter}`,
    platform: 'twitch',
    channelId: 'chan',
    author: { id: 'u1', name: name ?? 'Viewer', badges: [] },
    parts: [{ type: 'text', value: text ?? 'hello' }],
    timestamp: 1_700_000_000_000,
    ...rest
  }
}
