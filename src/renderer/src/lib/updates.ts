/**
 * renderer/src/lib/updates.ts   (how loudly the UI should announce an app update; pure, easy to test)
 *
 * `updatePending` is true from the moment a newer version is found until it is installed: the Settings button and the
 * About tab show a dot while it is true, so an update is never only discoverable by opening About.
 * `bannerText` is the sentence for the bar under the title while a download is under way.
 */
import type { UpdateState } from '../../../shared/types'

export function updatePending(s: UpdateState | undefined): boolean {
  return s?.status === 'available' || s?.status === 'downloading' || s?.status === 'ready'
}

/** Progress sentence for 'available' / 'downloading'; undefined for every other state. */
export function bannerText(s: UpdateState | undefined): string | undefined {
  if (s?.status === 'available') return `Version ${s.next} found. Downloading…`
  if (s?.status === 'downloading') return `Downloading version ${s.next}… ${Math.round(s.percent)}%`
  return undefined
}
