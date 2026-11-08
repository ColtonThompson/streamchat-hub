/**
 * renderer/src/store/liveStore.ts   (which followed Twitch channels are live)
 *
 * WHAT: A small Zustand store with the list the main process keeps (main/livewatch.ts), used for the
 * suggestions under the Twitch channels box. Empty when the go-live permission hasn't been granted.
 * `subscribeToLive()` loads the current list once, then follows pushes. App.tsx calls it at startup.
 */
import { create } from 'zustand'
import type { LiveChannel } from '../../../shared/types'

interface LiveStore {
  live: LiveChannel[]
}

export const useLiveStore = create<LiveStore>(() => ({ live: [] }))

export function subscribeToLive(): () => void {
  let active = true
  void window.api.liveFollows.get().then((live) => active && useLiveStore.setState({ live }))
  const off = window.api.liveFollows.onChange((live) => useLiveStore.setState({ live }))
  return () => {
    active = false
    off()
  }
}
