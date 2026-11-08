/**
 * renderer/src/components/settings/TwitchAccount.tsx
 *
 * WHAT: The Twitch sign-in controls (they used to sit in the top bar; now they live in
 *       Settings -> Accounts). It shows whichever of these applies:
 *   - not set up       a note: add your Twitch client ID to .env
 *   - signed out       [Sign in to Twitch]
 *   - waiting          the code to type on twitch.tv/activate, and [Cancel]
 *   - signed in        "Signed in as X", [Sign out], and for each optional extra either "... on" or an
 *                      [Enable ...] button that re-authorizes with the extra permissions:
 *                        moderation tools (delete / time out / ban)
 *                        polls & predictions (live cards for YOUR channel's polls and predictions)
 *                        go-live alerts (desktop notification when a channel you follow goes live)
 *
 * All the real work happens in the main process (main/twitch/auth.ts). This component only reads
 * `auth` from the store and calls `window.api.auth.*`.
 */
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore } from '../../store/settingsStore'

export function TwitchAccount() {
  const auth = useChatStore((s) => s.auth)
  const liveAlerts = useSettingsStore((s) => s.liveAlerts)
  const setLiveAlerts = useSettingsStore((s) => s.setLiveAlerts)

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
        {auth.canModerate ? (
          <span className="account-ok">Moderation tools on</span>
        ) : (
          <button
            className="tool"
            title="Asks Twitch for permission to delete messages, time out and ban. Only useful in channels where you are a moderator."
            onClick={() => void window.api.auth.login({ moderation: true })}
          >
            Enable moderation tools
          </button>
        )}
        {auth.canReadPolls ? (
          <span className="account-ok">Polls &amp; predictions on</span>
        ) : (
          <button
            className="tool"
            title="Asks Twitch for permission to read your channel's polls and predictions, so they appear above the chat while you run them. Works for your own channel only."
            onClick={() => void window.api.auth.login({ polls: true })}
          >
            Enable polls &amp; predictions
          </button>
        )}
        {auth.canReadPolls && (
          <p className="setting-help">
            Polls and predictions show for your own channel: add <strong>{auth.login}</strong> to the Twitch box and switch
            Twitch on.
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
        ) : (
          <button
            className="tool"
            title="Asks Twitch for permission to see which channels you follow are live, so a desktop notification can tell you who just went live and what they're playing."
            onClick={() => void window.api.auth.login({ follows: true })}
          >
            Enable go-live alerts
          </button>
        )}
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
