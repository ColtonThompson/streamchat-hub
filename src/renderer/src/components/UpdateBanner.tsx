/**
 * renderer/src/components/UpdateBanner.tsx
 *
 * WHAT: A bar under the title that announces app updates where you can't miss it.
 *   - while a new version downloads: "Downloading version X... 40%" (no buttons; nothing to decide yet)
 *   - once it is ready: "Version X is ready." with "Restart to update" and "Later"
 * "Later" hides the bar for this session (the update still installs on quit), but the dot on the Settings button and
 * About tab stays until the update is installed (see lib/updates.ts). Errors and "up to date" live in
 * Settings -> About, so nothing nags during a stream.
 */
import { useState } from 'react'
import { bannerText } from '../lib/updates'
import { useUpdateStore } from '../store/updateStore'

export function UpdateBanner() {
  const state = useUpdateStore((s) => s.state)
  const [dismissed, setDismissed] = useState<string>()

  const progress = bannerText(state)
  if (progress) {
    return (
      <div className="update-banner" data-status="downloading" role="status">
        <span>{progress}</span>
      </div>
    )
  }
  if (state?.status !== 'ready' || dismissed === state.next) return null

  return (
    <div className="update-banner" data-status="ready" role="status">
      <span>
        Update available: version <strong>{state.next}</strong> is ready to install.
      </span>
      <button className="tool update-go" onClick={() => void window.api.updates.install()}>
        Restart to update
      </button>
      <button className="tool" onClick={() => setDismissed(state.next)}>
        Later
      </button>
    </div>
  )
}
