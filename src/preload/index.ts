/**
 * preload/index.ts
 *
 * WHAT: Builds `window.api`, the ONLY way the UI can reach the main process.
 *
 * WHY IT EXISTS: For security the UI (renderer) has no access to Node or Electron. The preload script
 *   runs first, with limited access, and deliberately exposes a small set of functions. Even if
 *   malicious content ever ran in the UI, it could only call the functions listed here.
 *
 * HOW IT WORKS: each function either
 *   - `ipcRenderer.invoke(channel, ...args)`: sends a request to a matching `ipcMain.handle` in
 *     main/index.ts and returns a Promise with the answer; or
 *   - `ipcRenderer.on(channel, ...)`: listens for pushes from main (new chat batches, status,
 *     sign-in state). Those functions return an "unsubscribe" function for cleanup.
 *
 * The shape is checked against `HubApi` (shared/types.ts), so TypeScript tells you if a method here
 * and its declaration drift apart.
 *
 * CHANGE IT WHEN: you add a capability. Add the method to `HubApi` and `IPC` (shared/types.ts), then
 * implement it here and handle it in main/index.ts.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HubApi } from '../shared/types'

const api: HubApi = {
  // ---- pushes from main -> UI ---------------------------------------------------------
  onBatch(cb) {
    // The first argument of every Electron event is an internal event object we don't need.
    const handler = (_e: unknown, items: Parameters<typeof cb>[0]) => cb(items)
    ipcRenderer.on(IPC.batch, handler)
    return () => ipcRenderer.removeListener(IPC.batch, handler)
  },
  onStatus(cb) {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0], s: Parameters<typeof cb>[1]) => cb(p, s)
    ipcRenderer.on(IPC.status, handler)
    return () => ipcRenderer.removeListener(IPC.status, handler)
  },
  onZoomKey(cb) {
    const handler = (_e: unknown, action: Parameters<typeof cb>[0]) => cb(action)
    ipcRenderer.on(IPC.zoomKey, handler)
    return () => ipcRenderer.removeListener(IPC.zoomKey, handler)
  },

  // ---- requests UI -> main -------------------------------------------------------------
  setPlatformEnabled: (platform, enabled, channels) => ipcRenderer.invoke(IPC.toggle, platform, enabled, channels),
  setChannels: (platform, channels) => ipcRenderer.invoke(IPC.channels, platform, channels),
  setAlwaysOnTop: (value) => ipcRenderer.invoke(IPC.onTop, value),
  setLiveAlerts: (value) => ipcRenderer.invoke(IPC.liveAlerts, value),
  testNotification: () => ipcRenderer.invoke(IPC.alertsTest),
  setWindowTheme: (theme) => ipcRenderer.invoke(IPC.windowTheme, theme),
  sendChat: (platform, channel, text) => ipcRenderer.invoke(IPC.send, platform, channel, text),
  moderate: (command) => ipcRenderer.invoke(IPC.moderate, command),

  // ---- sign-in -----------------------------------------------------------------------------
  auth: {
    get: () => ipcRenderer.invoke(IPC.authGet),
    login: (options) => ipcRenderer.invoke(IPC.authLogin, options),
    cancel: () => ipcRenderer.invoke(IPC.authCancel),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    onState(cb) {
      const handler = (_e: unknown, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.authState, handler)
      return () => ipcRenderer.removeListener(IPC.authState, handler)
    }
  },

  // ---- title and viewers of the one stream being read ---------------------------------------
  streamInfo: {
    watch: (target) => ipcRenderer.invoke(IPC.streamInfoWatch, target),
    onChange(cb) {
      const handler = (_e: unknown, info: Parameters<typeof cb>[0]) => cb(info)
      ipcRenderer.on(IPC.streamInfoChanged, handler)
      return () => ipcRenderer.removeListener(IPC.streamInfoChanged, handler)
    }
  },

  // ---- followed channels that are live ------------------------------------------------------
  liveFollows: {
    get: () => ipcRenderer.invoke(IPC.liveGet),
    onChange(cb) {
      const handler = (_e: unknown, live: Parameters<typeof cb>[0]) => cb(live)
      ipcRenderer.on(IPC.liveChanged, handler)
      return () => ipcRenderer.removeListener(IPC.liveChanged, handler)
    }
  },

  // ---- app updates -------------------------------------------------------------------------
  updates: {
    get: () => ipcRenderer.invoke(IPC.updatesGet),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onState(cb) {
      const handler = (_e: unknown, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.updatesState, handler)
      return () => ipcRenderer.removeListener(IPC.updatesState, handler)
    }
  }
}

// Makes `api` available in the UI as `window.api` (typed in renderer/src/env.d.ts).
contextBridge.exposeInMainWorld('api', api)
