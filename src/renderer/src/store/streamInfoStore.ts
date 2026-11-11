/**
 * renderer/src/store/streamInfoStore.ts   (title and viewers of the one stream being read)
 *
 * WHAT: Holds the latest `StreamInfo` pushed by the main process (main/streaminfo.ts), and keeps the main process
 * told WHICH stream to follow: `useStreamInfoSync()` (called from App.tsx) works out the single stream from the
 * settings and the platform toggles and sends it, or `null` when the setting is off or several streams are read.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { StreamInfo } from '../../../shared/types'
import { streamInfoTarget } from '../lib/streaminfo'
import { useChatStore } from './chatStore'
import { useSettingsStore } from './settingsStore'

interface StreamInfoStore {
  info: StreamInfo | null
}

export const useStreamInfoStore = create<StreamInfoStore>(() => ({ info: null }))

export function subscribeToStreamInfo(): () => void {
  return window.api.streamInfo.onChange((info) => useStreamInfoStore.setState({ info }))
}

/** Tell the main process which single stream (if any) to follow, whenever that changes. */
export function useStreamInfoSync(): void {
  const show = useSettingsStore((s) => s.showStreamInfo)
  const enabled = useChatStore((s) => s.enabled)
  const channels = useChatStore((s) => s.channels)
  const target = streamInfoTarget(show, enabled, channels)
  const key = target ? `${target.platform}:${target.source}` : ''
  useEffect(() => {
    void window.api.streamInfo.watch(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
