/**
 * renderer/src/components/PermissionBanner.tsx
 *
 * WHAT: A slim bar that appears when what you are doing needs a Twitch permission you have not given (see
 * lib/permissions.ts `permissionNotice`): for now, reading your own channel without the polls / redemptions
 * permissions. [Allow] re-opens the Twitch approval page asking for just what is missing; [Not now] hides this
 * notice for good (remembered; it comes back only if the situation changes, e.g. a different permission is missing).
 * Everything is also listed with explanations in Settings -> Accounts.
 */
import { useState } from 'react'
import { loginOptionsFor, permissionNotice } from '../lib/permissions'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'

const KEY = 'hub.permissionNoticesDismissed'

function loadDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function PermissionBanner() {
  const auth = useChatStore((s) => s.auth)
  const enabled = useChatStore((s) => s.enabled)
  const twitchChannels = useChatStore((s) => s.channels.twitch)
  const openPanel = useSettingsStore((s) => s.openPanel)
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)

  const notice = permissionNotice(auth, enabled, twitchChannels)
  if (!notice || dismissed.includes(notice.key)) return null

  const hide = () => {
    const next = [...dismissed, notice.key]
    setDismissed(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable: it just comes back next launch */
    }
  }

  return (
    <div className="update-banner" role="status">
      <span>{notice.text}</span>
      <button className="tool" onClick={() => void window.api.auth.login(loginOptionsFor(notice.ids))}>
        Allow
      </button>
      <button className="tool" onClick={() => openPanel('accounts')}>
        Details
      </button>
      <button className="tool" onClick={hide}>
        Not now
      </button>
    </div>
  )
}
