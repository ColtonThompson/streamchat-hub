/**
 * main/adapters/base.ts
 *
 * WHAT: The contract every platform adapter must follow. An "adapter" is the piece of code that
 *       knows how to talk to ONE platform (Twitch, YouTube, ...) and turns its data into the app's
 *       common `ChatMessage` shape.
 *
 * HOW IT FITS: The MessageBus creates adapters (via adapters/index.ts) and passes each one an
 *       `AdapterEmit`: a set of callbacks for handing data back. The adapter never touches the UI.
 *
 * TO ADD A PLATFORM:
 *   1. Create `adapters/<platform>/index.ts` with a class that `implements ChatAdapter`.
 *   2. Convert incoming messages to `ChatMessage` and call `emit.message(...)`.
 *   3. Register it in adapters/index.ts. (The platform's name must already be in `Platform`,
 *      shared/types.ts.) That's all: the UI needs no changes to show its messages.
 */
import type { ChatMessage, ModerationEvent, Platform, PlatformStatus } from '../../shared/types'

/** The callbacks an adapter uses to report what is happening. */
export interface AdapterEmit {
  /** A new chat line or event row. */
  message(m: ChatMessage): void
  /** Update the platform chip in the top bar (connecting / connected / error + tooltip text). */
  status(s: PlatformStatus): void
  /** A message was deleted, or a user was timed out or banned. Optional: not every platform has this. */
  moderation?(action: ModerationEvent): void
  /**
   * The platform told us a channel's numeric id. Optional. Third-party emotes and the moderation API
   * need that id, so adapters call this as soon as they learn it.
   */
  channelReady?(channel: string, platformId: string): void
}

export interface ChatAdapter {
  readonly platform: Platform
  /** Open the connection. Should resolve quickly; reconnecting after drops is the adapter's own job. */
  connect(): Promise<void>
  /** Close the connection and stop all timers. */
  disconnect(): void
  /** Optional: change which channels are read while connected (without reconnecting). */
  setChannels?(channels: string[]): void
}
