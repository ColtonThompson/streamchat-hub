/**
 * renderer/src/App.tsx   (the root component: the screen's overall layout)
 *
 * LAYOUT (top to bottom):
 *   title bar -> update banner (only when an update is ready) -> platform bar (toggles, channels, tools) -> poll/prediction cards (only when one is running)
 *   -> chat feed -> toast -> message box
 * The Settings panel is drawn on top of all of this when open (it covers everything below the title bar).
 *
 * It also keeps the colours in step with the chosen theme (`useThemeSync`), and connects the UI to the
 * main process ONCE at startup: `subscribeToMain()` (store/chatStore.ts)
 * starts listening for chat batches, connection status and sign-in changes, and the returned
 * "unsubscribe" function runs when the component unmounts.
 */
import { useEffect } from 'react'
import { ActivityPanel } from './components/ActivityPanel'
import { ChatFeed } from './components/ChatFeed'
import { Composer } from './components/Composer'
import { PlatformBar } from './components/PlatformBar'
import { UpdateBanner } from './components/UpdateBanner'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Toast } from './components/Toast'
import { subscribeToMain } from './store/chatStore'
import { subscribeToLive } from './store/liveStore'
import { useSettingsStore } from './store/settingsStore'
import { useThemeSync } from './store/themeSync'
import { subscribeToUpdates } from './store/updateStore'

export default function App() {
  useEffect(() => subscribeToMain(), [])
  useEffect(() => subscribeToUpdates(), [])
  useEffect(() => subscribeToLive(), [])
  useThemeSync()
  // Ctrl +/-/0 are spotted by the main process (so the default menu can't grab them) and arrive here.
  useEffect(() => window.api.onZoomKey((action) => useSettingsStore.getState().zoom(action)), [])
  // Tell the main process whether go-live notifications are wanted (at startup and whenever it changes).
  const liveAlerts = useSettingsStore((s) => s.liveAlerts)
  useEffect(() => void window.api.setLiveAlerts(liveAlerts), [liveAlerts])

  return (
    <div className="app">
      {/* The drag region lets you move the window by grabbing this strip (see .titlebar in styles.css). */}
      <div className="titlebar">StreamChat Hub</div>
      <UpdateBanner />
      <PlatformBar />
      <ActivityPanel />
      <ChatFeed />
      <Toast />
      <Composer />
      <SettingsPanel />
    </div>
  )
}
