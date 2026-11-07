/**
 * renderer/src/components/settings/AboutTab.tsx
 *
 * WHAT: Shows the app version and the update status, with a "Check for updates" button.
 * The state comes from the main process (main/updater.ts) through store/updateStore.ts.
 */
import type { UpdateState } from '../../../../shared/types'
import { useUpdateStore } from '../../store/updateStore'

/** One line describing where the updater is. Exported so it can be tested without rendering. */
export function updateText(s: UpdateState | undefined): string {
  if (!s) return 'Loading...'
  switch (s.status) {
    case 'disabled':
      return 'Updates are off while running from source (npm run dev).'
    case 'idle':
      return 'Checks for updates automatically.'
    case 'checking':
      return 'Checking for updates...'
    case 'none':
      return 'You have the latest version.'
    case 'available':
      return `Version ${s.next} found. Starting download...`
    case 'downloading':
      return `Downloading version ${s.next}: ${s.percent}%`
    case 'ready':
      return `Version ${s.next} is downloaded and will install when you restart.`
    case 'error':
      return `Couldn't check for updates: ${s.message}`
  }
}

export function AboutTab() {
  const state = useUpdateStore((s) => s.state)
  const busy = state?.status === 'checking' || state?.status === 'downloading' || state?.status === 'available'
  const canCheck = !!state && state.status !== 'disabled' && state.status !== 'ready' && !busy

  return (
    <section className="setting">
      <h3 className="setting-title">StreamChat Hub</h3>
      <p className="setting-help">Version {state?.version ?? '...'}</p>

      <div className="account">
        <span role="status">{updateText(state)}</span>
        {state?.status === 'ready' ? (
          <button className="tool" onClick={() => void window.api.updates.install()}>
            Restart to update
          </button>
        ) : (
          <button className="tool" disabled={!canCheck} onClick={() => void window.api.updates.check()}>
            Check for updates
          </button>
        )}
      </div>
    </section>
  )
}
