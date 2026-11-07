/**
 * renderer/src/components/Toast.tsx
 *
 * WHAT: A short notice just above the message box (e.g. "Twitch refused this: you're not a
 *       moderator"). Anything can show one with `useChatStore.getState().showToast(text, kind)`;
 *       the store removes it after a few seconds.
 *
 * `aria-live="polite"` makes screen readers announce the text when it appears.
 */
import { useChatStore } from '../store/chatStore'

export function Toast() {
  const toast = useChatStore((s) => s.toast)
  if (!toast) return null
  return (
    <div className="toast" data-kind={toast.kind} role="status" aria-live="polite">
      {toast.text}
    </div>
  )
}
