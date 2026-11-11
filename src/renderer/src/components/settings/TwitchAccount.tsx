/**
 * renderer/src/components/settings/TwitchAccount.tsx
 *
 * WHAT: The Twitch sign-in controls (they used to sit in the top bar; now they live in
 *       Settings -> Accounts). It shows whichever of these applies:
 *   - not set up       a note: add your Twitch client ID to .env
 *   - signed out       [Sign in to Twitch]
 *   - waiting          the code to type on twitch.tv/activate, and [Cancel]
 *   - signed in        "Signed in as X", [Sign out], and a checklist of the optional permissions (lib/permissions.ts):
 *                      each shows whether it is on, what it enables, and an [Allow] button when it is off
 *                      (re-authorizes with the extra permission); [Allow all] asks for every missing one at once.
 *
 * All the real work happens in the main process (main/twitch/auth.ts). This component only reads
 * `auth` from the store and calls `window.api.auth.*`.
 */
import { loginOptionsFor, missingPermissions, permissionStatus } from '../../lib/permissions'
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore } from '../../store/settingsStore'

export function TwitchAccount() {
  const auth = useChatStore((s) => s.auth)
  const liveAlerts = useSettingsStore((s) => s.liveAlerts)
  const setLiveAlerts = useSettingsStore((s) => s.setLiveAlerts)
  const missing = missingPermissions(auth)

  if (!auth.configured) {
    return (
      <p className="account-note">
        Twitch sign-in isn&rsquo;t set up yet. Add your Twitch client ID to <code>.env</code> (see the README).
      </p>
    )
  }

  if (auth.status === 'signed-in') {
    return (
      <div className="account">
        <span>
          Signed in as <strong>{auth.login}</strong>
        </span>
        <button className="tool" onClick={() => void window.api.auth.logout()}>
          Sign out
        </button>
        <div className="perm-list" role="list" aria-label="Twitch permissions">
          {permissionStatus(auth).map(({ info, granted }) => (
            <div className="perm" role="listitem" key={info.id} data-granted={granted}>
              <span className="perm-mark" aria-label={granted ? 'On' : 'Off'}>
                {granted ? '✓' : '✗'}
              </span>
              <span className="perm-text">
                <strong>{info.label}</strong>
                <span className="perm-enables">{info.enables}</span>
              </span>
              {!granted && (
                <button className="tool" onClick={() => void window.api.auth.login(loginOptionsFor([info.id]))}>
                  Allow
                </button>
              )}
            </div>
          ))}
        </div>
        {missing.length > 1 && (
          <button className="tool" onClick={() => void window.api.auth.login(loginOptionsFor(missing.map((m) => m.id)))}>
            Allow all ({missing.length} missing)
          </button>
        )}
        {(auth.canReadPolls || auth.canReadRedemptions) && (
          <p className="setting-help">
            Polls, predictions and reward redemptions show for your own channel: add <strong>{auth.login}</strong> to the Twitch
            box and switch Twitch on.
          </p>
        )}
        {auth.canReadFollows ? (
          <>
            <label className="check">
              <input type="checkbox" checked={liveAlerts} onChange={(e) => setLiveAlerts(e.target.checked)} />
              Notify me when channels I follow go live
            </label>
            <button
              className="tool"
              title="Shows a sample notification so you can check that Windows displays them."
              onClick={() => void window.api.testNotification()}
            >
              Send test notification
            </button>
          </>
        ) : null}
        {auth.error && <span className="account-error">{auth.error}</span>}
      </div>
    )
  }

  if (auth.status === 'pending') {
    return (
      <div className="account">
        <span>
          Enter <strong className="code">{auth.userCode}</strong> on Twitch to finish signing in
        </span>
        {/* cancel() keeps an existing session; logout() would end it. */}
        <button className="tool" onClick={() => void window.api.auth.cancel()}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="account">
      <button className="tool" onClick={() => void window.api.auth.login()}>
        Sign in to Twitch
      </button>
      {auth.error && <span className="account-error">{auth.error}</span>}
    </div>
  )
}
