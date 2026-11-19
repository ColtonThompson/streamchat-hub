/**
 * renderer/src/components/AddChannelModal.tsx   (the "Add channel" window)
 *
 * WHAT: Pick a platform (Twitch or YouTube), type the channel (a Twitch name or twitch.tv link; a YouTube @handle,
 * stream link or video id) and press Add. The channel joins your current feed right away (the platform connects with its
 * first channel) and a "Joined ..." divider appears in the chat. The rules for what is accepted are in
 * shared/channels.ts (`parseSources`); this file only shows them: under the box it says what will be added, or why
 * the text isn't accepted.
 *
 * With Twitch selected and the go-live permission granted (Settings -> Accounts), the channels you follow that are
 * live right now are listed below the box: click one to add it.
 *
 * Enter adds, Esc (or a click outside) closes. Opened with `useAddChannelStore().show()`.
 */
import { useEffect, useRef, useState } from 'react'
import { parseSources } from '../../../shared/channels'
import { sourceLabel } from '../lib/channelbreaks'
import { PLATFORM_META } from '../lib/platforms'
import { useAddChannelStore } from '../store/addChannelStore'
import { useChatStore } from '../store/chatStore'
import { useLiveStore } from '../store/liveStore'

const CHOICES: ('twitch' | 'youtube')[] = ['twitch', 'youtube']

const COPY: Record<'twitch' | 'youtube', { label: string; placeholder: string; hint: string }> = {
  twitch: { label: 'Twitch channel', placeholder: 'channel name or twitch.tv link', hint: 'Several at once: separate them with commas or spaces.' },
  youtube: { label: 'YouTube channel or stream', placeholder: '@handle, stream link or video id', hint: 'An @handle follows that channel whenever it is live; a stream link or video id reads that one stream.' }
}

/** 1234 -> "1.2K", 15300 -> "15K". */
function viewers(n: number): string {
  if (n < 1000) return String(n)
  return n < 10_000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n / 1000)}K`
}

export function AddChannelModal() {
  const open = useAddChannelStore((s) => s.open)
  const startPlatform = useAddChannelStore((s) => s.platform)
  const hide = useAddChannelStore((s) => s.hide)
  if (!open) return null
  // Mounting fresh each time it opens resets the text and the error.
  return <Dialog startPlatform={startPlatform} onClose={hide} />
}

function Dialog({ startPlatform, onClose }: { startPlatform: string; onClose: () => void }) {
  const [platform, setPlatform] = useState<'twitch' | 'youtube'>(startPlatform === 'youtube' ? 'youtube' : 'twitch')
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const addChannel = useChatStore((s) => s.addChannel)
  const showToast = useChatStore((s) => s.showToast)
  const channels = useChatStore((s) => s.channels)
  const canSuggest = useChatStore((s) => s.auth.status === 'signed-in' && !!s.auth.canReadFollows)
  const live = useLiveStore((s) => s.live)

  const copy = COPY[platform]
  const parsed = parseSources(platform, text)
  const inFeed = parseSources(platform, channels[platform])
  const fresh = parsed.filter((c) => !inFeed.includes(c))
  const typed = text.trim().length > 0

  useEffect(() => input.current?.focus(), [platform])

  // Esc closes. Capture phase + stopPropagation so the Settings panel under us doesn't also close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function add(value: string) {
    const result = addChannel(platform, value)
    if ('error' in result) return setError(result.error)
    showToast(`Joined ${result.added.map((c) => sourceLabel(platform, c)).join(', ')}`)
    onClose()
  }

  function pickPlatform(p: 'twitch' | 'youtube') {
    setPlatform(p)
    setError(undefined)
  }

  const suggestions = platform === 'twitch' && canSuggest ? live.filter((l) => !inFeed.includes(l.login)) : []

  return (
    <div
      className="mp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        className="mp ac"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ac-title"
        onSubmit={(e) => {
          e.preventDefault()
          add(text)
        }}
      >
        <header className="mp-head">
          <h2 id="ac-title" className="mp-title">
            Add channel
          </h2>
          <span className="mp-where">It joins your current feed right away.</span>
        </header>

        <div className="ac-body">
          <div className="ac-platforms" role="radiogroup" aria-label="Platform">
            {CHOICES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={platform === p}
                className="ac-platform"
                data-on={platform === p}
                style={{ ['--accent' as string]: PLATFORM_META[p].color }}
                onClick={() => pickPlatform(p)}
              >
                {PLATFORM_META[p].label}
              </button>
            ))}
          </div>

          <label className="channels-label" htmlFor="ac-input">
            {copy.label}
          </label>
          <input
            id="ac-input"
            ref={input}
            className="channels-input"
            value={text}
            placeholder={copy.placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-describedby="ac-note"
            onChange={(e) => {
              setText(e.target.value)
              setError(undefined)
            }}
          />
          <p id="ac-note" className="ac-note" role={error ? 'alert' : undefined} data-error={!!error || (typed && parsed.length === 0) || undefined}>
            {error ??
              (!typed
                ? copy.hint
                : parsed.length === 0
                  ? platform === 'youtube'
                    ? 'Not recognised. Use an @handle, a youtube.com link or an 11-character video id.'
                    : 'Not recognised. Use a channel name or a twitch.tv link.'
                  : fresh.length === 0
                    ? 'Already in your feed.'
                    : `Will join: ${fresh.map((c) => sourceLabel(platform, c)).join(', ')}`)}
          </p>

          {platform === 'twitch' && suggestions.length > 0 && (
            <>
              <p className="channels-label">Live now, from channels you follow</p>
              <ul className="ac-live" aria-label="Followed channels that are live">
                {suggestions.map((l) => (
                  <li key={l.login}>
                    <button type="button" className="ac-live-item" onClick={() => add(l.login)}>
                      <span className="ac-live-name">{l.name}</span>
                      <span className="ac-live-game">{l.game || 'No category'}</span>
                      <span className="ac-live-viewers">{viewers(l.viewers)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {platform === 'twitch' && !canSuggest && (
            <p className="ac-note">To also pick from the channels you follow, allow go-live alerts in Settings → Accounts.</p>
          )}
        </div>

        <footer className="mp-actions">
          <button type="submit" className="mp-btn ac-submit" disabled={parsed.length === 0 || fresh.length === 0}>
            Add channel
          </button>
          <button type="button" className="mp-btn mp-close" onClick={onClose}>
            Cancel <kbd>Esc</kbd>
          </button>
        </footer>
      </form>
    </div>
  )
}
