/**
 * renderer/src/components/Composer.tsx   (the message box at the bottom)
 *
 * WHAT: Lets you send a chat message to Twitch. It is disabled (with a hint in the box) until
 *       everything needed is true: signed in, Twitch switched on and connected, and a channel chosen.
 *
 * Pressing Send calls `window.api.sendChat`. Your own message is NOT added locally: it returns through
 * the normal chat connection like everyone else's, so it shows with its emotes and badges for free.
 * If Twitch rejects it (slow mode, banned phrase...) the reason appears above the box.
 *
 * EMOTES: the smiley button opens EmotePicker.tsx; clicking an emote there inserts its name at the cursor.
 *
 * With several channels listed, a dropdown picks which one to send to.
 *
 * TAB COMPLETION: type "@" and the start of a name, press Tab, and it is completed with the most recent
 * chatter in the chosen channel whose name starts that way. Tab again cycles through the other matches
 * (Shift+Tab goes back). The logic is in lib/mentions.ts (`completeMention`); this file only wires the
 * key press to it and puts the text cursor back after the inserted name.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { parseChannels } from '../../../shared/channels'
import { insertEmote } from '../lib/emotepicker'
import { completeMention, recentChatters, type CompletionSession } from '../lib/mentions'
import { useChatStore } from '../store/chatStore'
import { EmotePicker } from './EmotePicker'

export function Composer() {
  const auth = useChatStore((s) => s.auth)
  const twitchOn = useChatStore((s) => s.enabled.twitch)
  const twitchState = useChatStore((s) => s.status.twitch.state)
  const rawChannels = useChatStore((s) => s.channels.twitch)

  const channels = useMemo(() => parseChannels(rawChannels), [rawChannels])
  const [target, setTarget] = useState('') // the channel picked in the dropdown
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  /** Where Tab completion left off, so pressing Tab again cycles. Cleared whenever you type. */
  const completion = useRef<CompletionSession | undefined>(undefined)
  /** Where to put the text cursor after a completion changed the text (applied once the new text is drawn). */
  const pendingCursor = useRef<number | undefined>(undefined)

  // If the chosen channel was removed from the list, fall back to the first one.
  const channel = channels.includes(target) ? target : channels[0]
  const signedIn = auth.status === 'signed-in'
  const ready = signedIn && twitchOn && twitchState === 'connected' && !!channel

  // Tell the user what's missing instead of leaving a mysteriously disabled box.
  const placeholder = !signedIn
    ? 'Sign in to chat (Settings → Accounts)'
    : !twitchOn
      ? 'Turn on Twitch to chat'
      : !channel
        ? 'Add a Twitch channel to chat'
        : `Message #${channel}`

  // A programmatic change to the text moves the cursor to the end; put it back where the completion wants it.
  useLayoutEffect(() => {
    if (pendingCursor.current !== undefined) {
      inputRef.current?.setSelectionRange(pendingCursor.current, pendingCursor.current)
      pendingCursor.current = undefined
    }
  }, [text])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') return void submit()
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || !channel) return
    const input = e.currentTarget
    // Read the chat history now (not via a subscription): it changes constantly and we only need it on Tab.
    const chatters = recentChatters(useChatStore.getState().messages, 'twitch', channel)
    const result = completeMention(input.value, input.selectionStart ?? input.value.length, chatters, completion.current, e.shiftKey)
    if (!result) return // the cursor isn't in an "@word": let Tab move focus as usual
    e.preventDefault()
    completion.current = result.session
    if (result.text !== input.value) {
      pendingCursor.current = result.cursor
      setText(result.text)
    }
  }

  /** Put an emote's name into the message at the cursor (the input remembers its cursor while the picker has focus). */
  function pickEmote(name: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? text.length
    const end = input?.selectionEnd ?? text.length
    const result = insertEmote(text, start, end, name, 500)
    if (!result) return // would not fit in 500 characters
    completion.current = undefined
    pendingCursor.current = result.cursor
    setText(result.text)
    input?.focus()
  }

  async function submit() {
    const message = text.trim()
    if (!message || !channel || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.api.sendChat('twitch', channel, message)
      if (result.ok) setText('') // keep the text if it failed so the user can fix and retry
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="composer">
      {pickerOpen && ready && channel && <EmotePicker channel={channel} onPick={pickEmote} onClose={() => setPickerOpen(false)} />}
      {error && <p className="composer-error">{error}</p>}
      <div className="composer-row">
        {channels.length > 1 && (
          <select className="composer-target" value={channel} onChange={(e) => setTarget(e.target.value)} aria-label="Send to channel">
            {channels.map((c) => (
              <option key={c} value={c}>
                #{c}
              </option>
            ))}
          </select>
        )}
        <input
          ref={inputRef}
          className="composer-input"
          value={text}
          maxLength={500} // Twitch's message limit
          disabled={!ready}
          placeholder={placeholder}
          onChange={(e) => {
            completion.current = undefined // typing ends any Tab-cycling in progress
            setText(e.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        <button
          className="composer-emote"
          data-emote-toggle
          disabled={!ready}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          title="Emotes"
          aria-label="Emotes"
          onClick={() => setPickerOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2" />
            <path d="M9 9.5h.01M15 9.5h.01" />
          </svg>
        </button>
        <button className="composer-send" disabled={!ready || busy || !text.trim()} onClick={() => void submit()}>
          Send
        </button>
      </div>
    </div>
  )
}
