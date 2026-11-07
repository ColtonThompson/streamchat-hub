/**
 * renderer/src/components/ChannelInput.tsx
 *
 * WHAT: The text box where you say what to read for ONE platform: Twitch channel names, or YouTube
 *       @handles / stream links. PlatformBar shows one box per platform that has a real adapter.
 *
 * You type freely ("mychannel, friend") into a local `draft`; the cleaned list is saved to the store
 * only when you press Enter or click away. This avoids reconnecting on every keystroke. The store
 * saves it to localStorage and, if the platform is on, applies it live (joins/leaves channels).
 * "Cleaned" uses `parseSources` (shared/channels.ts), which has the right rules for each platform.
 *
 * TO ADD A BOX FOR ANOTHER PLATFORM: add its label/placeholder to `COPY` below and render
 * `<ChannelInput platform="..." />` in PlatformBar.
 */
import { useEffect, useState } from 'react'
import { parseSources } from '../../../shared/channels'
import type { Platform } from '../../../shared/types'
import { useChatStore } from '../store/chatStore'

/** The wording for each box. */
const COPY: Partial<Record<Platform, { label: string; placeholder: string; hint: string }>> = {
  twitch: {
    label: 'Twitch channels',
    placeholder: 'your_channel, another_channel',
    hint: 'Twitch channel names, separated by commas or spaces'
  },
  youtube: {
    label: 'YouTube streams',
    placeholder: '@yourhandle, or paste a stream link',
    hint: 'An @handle follows that channel whenever it is live; a stream link or video id reads that one stream. Handles need the @.'
  }
}

export function ChannelInput({ platform }: { platform: Platform }) {
  const saved = useChatStore((s) => s.channels[platform])
  const status = useChatStore((s) => s.status[platform])
  const setChannels = useChatStore((s) => s.setChannels)
  const [draft, setDraft] = useState(saved) // what's currently typed
  const copy = COPY[platform] ?? { label: platform, placeholder: '', hint: '' }

  // If the saved value changes from elsewhere (e.g. loaded at startup), reflect it in the box.
  useEffect(() => setDraft(saved), [saved])

  /** Clean the text (drops invalid entries, tidies separators) and save it. */
  const commit = () => setChannels(platform, parseSources(platform, draft).join(', '))

  return (
    <label className="channels" title={copy.hint}>
      <span className="channels-label">{copy.label}</span>
      <input
        className="channels-input"
        value={draft}
        placeholder={copy.placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} // blur() triggers commit
      />
      {status.state === 'error' && <span className="channels-error">{status.detail}</span>}
    </label>
  )
}
