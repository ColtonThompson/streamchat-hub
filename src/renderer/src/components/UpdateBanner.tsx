/**
 * renderer/src/components/UpdateBanner.tsx
 *
 * WHAT: A slim bar under the title: "Version X is ready - Restart to update". Shown only once an update
 * has finished downloading. "Later" hides it for this session (the update still installs on quit).
 * Progress, errors and "up to date" live in Settings -> About instead, so nothing nags during a stream.
 */
import { useState } from 'react'
import { useUpdateStore } from '../store/updateStore'

export function UpdateBanner() {
  const state = useUpdateStore((s) => s.state)
  const [dismissed, setDismissed] = useState<string>()
  if (state?.status !== 'ready' || dismissed === state.next) return null

  return (
    <div className="update-banner" role="status">
      <span>
        Version <strong>{state.next}</strong> is ready.
      </span>
      <button className="tool" onClick={() => void window.api.updates.install()}>
        Restart to update
      </button>
      <button className="tool" onClick={() => setDismissed(state.next)}>
        Later
      </button>
    </div>
  )
}
