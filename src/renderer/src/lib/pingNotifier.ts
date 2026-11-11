/**
 * renderer/src/lib/pingNotifier.ts   (plays the alert when someone @mentions you)
 *
 * WHAT: Listens to every batch of new messages from the main process (same feed the chat uses) and, for each message
 * that pings you (lib/pings.ts), plays a short beep and/or shows a desktop notification, per Settings -> Chat.
 *   - The notification only appears when the app window is NOT focused (you can already see the chat when it is).
 *   - The beep plays whenever the setting is on, at most once every 3 seconds so a spammy chat can't machine-gun you.
 *   - Messages older than a minute are ignored (YouTube replays recent chat when it connects).
 *   - Each message alerts once (ids are remembered), even if it arrives twice.
 * `subscribeToPings()` is called once from App.tsx and returns a function that stops listening.
 */
import type { ChatMessage } from '../../../shared/types'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { findPing, pingNamesFor } from './pings'

const MAX_AGE_MS = 60_000
const BEEP_GAP_MS = 3_000
const SEEN_LIMIT = 500

let audio: AudioContext | undefined
let lastBeep = 0

function beep(): void {
  const now = Date.now()
  if (now - lastBeep < BEEP_GAP_MS) return
  lastBeep = now
  try {
    audio ??= new AudioContext()
    void audio.resume()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, audio.currentTime)
    osc.frequency.setValueAtTime(1175, audio.currentTime + 0.09)
    gain.gain.setValueAtTime(0.0001, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3)
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.32)
  } catch {
    // No audio available: the notification (if on) still works.
  }
}

function notify(msg: ChatMessage): void {
  if (typeof Notification === 'undefined' || document.hasFocus()) return
  const text = msg.parts.map((p) => (p.value)).join('').slice(0, 200)
  try {
    const n = new Notification(`${msg.author.name} mentioned you`, { body: text, silent: true, tag: 'ping' })
    n.onclick = () => window.focus()
  } catch {
    // Notifications blocked by the OS: nothing else to do.
  }
}

export function subscribeToPings(): () => void {
  const seen = new Set<string>()
  return window.api.onBatch((items) => {
    const { pingAlerts, pingSound, pingNames } = useSettingsStore.getState()
    if (!pingAlerts && !pingSound) return
    const names = pingNamesFor(useChatStore.getState().auth.login, pingNames)
    const cutoff = Date.now() - MAX_AGE_MS
    let ring = false
    for (const item of items) {
      if (item.kind !== 'message') continue
      const msg = item.message
      if (msg.timestamp < cutoff || seen.has(msg.id) || !findPing(msg, names)) continue
      seen.add(msg.id)
      if (pingAlerts) notify(msg)
      ring = true
    }
    if (seen.size > SEEN_LIMIT) for (const id of [...seen].slice(0, seen.size - SEEN_LIMIT)) seen.delete(id)
    if (ring && pingSound) beep()
  })
}
