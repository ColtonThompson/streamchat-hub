/**
 * renderer/src/env.d.ts
 *
 * WHAT: Tells TypeScript that `window.api` exists in the UI. It is created at runtime by the preload
 *       script (src/preload/index.ts); this file only declares its type (`HubApi`, shared/types.ts).
 */
import type { HubApi } from '../../shared/types'

declare global {
  interface Window {
    api: HubApi
  }
}
export {} // makes this file a module so the `declare global` above is allowed
