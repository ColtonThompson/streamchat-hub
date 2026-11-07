/**
 * renderer/src/store/updateStore.ts   (app-update state for the UI)
 *
 * WHAT: A small Zustand store holding the updater's current `UpdateState` (see main/updater.ts).
 * `subscribeToUpdates()` loads the current state once and then follows pushes from the main process;
 * App.tsx calls it at startup. The UpdateBanner and the About tab read from here.
 */
import { create } from 'zustand'
import type { UpdateState } from '../../../shared/types'

interface UpdateStore {
  state?: UpdateState
}

export const useUpdateStore = create<UpdateStore>(() => ({ state: undefined }))

export function subscribeToUpdates(): () => void {
  let live = true
  void window.api.updates.get().then((s) => live && useUpdateStore.setState((cur) => (cur.state ? cur : { state: s })))
  const off = window.api.updates.onState((s) => useUpdateStore.setState({ state: s }))
  return () => {
    live = false
    off()
  }
}
